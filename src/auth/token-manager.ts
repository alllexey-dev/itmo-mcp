import type { Credentials } from "../config.js";
import { AuthError, CredentialRejectedError } from "./errors.js";
import { pairedCookie } from "./grants.js";
import { isuFromAccessToken, type ItmoIdClient, MY_ITMO_CLIENT, type TokenSet } from "./itmo-id.js";
import { tokensFromCookie } from "./paired-session.js";
import type { SsoLogin } from "./sso.js";
import type { AuthState, Connection, StateStore } from "./state-store.js";

const EXPIRY_SKEW_MS = 30_000;

export const SESSION_CLOSED =
  "The ITMO.ID session of this ITMO.Widgets connection has ended: run `itmo-mcp renew` and approve it on the phone";

export const NO_ITMO_SESSION =
  "This ITMO.Widgets connection has no ITMO sign-in (the ITMO grants were turned off on the phone), so only widgets_* " +
  "tools work. my.itmo needs the grant itmo:refresh:student-personal-cabinet: run `itmo-mcp renew` (or " +
  "`itmo-mcp renew --itmo-cookie` for BARS too) and approve it on the phone";

/**
 * Access tokens for my.itmo.ru: refresh token first, then SSO login. Refreshes are single-flight.
 * A paired server uses only its own session (its refresh token, then its cookie when it holds `itmo:sso`): once
 * ITMO.ID refuses both, the session is marked closed and no further ITMO.ID calls are made until `itmo-mcp renew`.
 */
export class TokenManager {
  private tokens: TokenSet | undefined;
  private pending: Promise<TokenSet> | undefined;

  constructor(
    private readonly idClient: ItmoIdClient,
    private readonly sso: SsoLogin,
    private readonly store: StateStore,
    private readonly credentials: Credentials,
    private readonly now: () => number = Date.now,
    /** Called once the paired session is found closed, after the state says so. */
    private readonly onSessionClosed: () => Promise<void> = async () => undefined,
  ) {}

  async accessToken(): Promise<string> {
    if (this.tokens && this.tokens.expiresAt - EXPIRY_SKEW_MS > this.now()) return this.tokens.accessToken;
    return (await this.obtain()).accessToken;
  }

  /** Drops the cached access token (e.g. after a 401) and obtains a new one. */
  async forceRefresh(): Promise<string> {
    if (this.tokens) this.tokens = { ...this.tokens, expiresAt: 0 };
    return (await this.obtain()).accessToken;
  }

  async isu(): Promise<number> {
    const isu = isuFromAccessToken(await this.accessToken());
    if (!isu) throw new AuthError("ITMO.ID access token has no isu claim");
    return isu;
  }

  private obtain(): Promise<TokenSet> {
    this.pending ??= this.fetchTokens().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private async fetchTokens(): Promise<TokenSet> {
    const state = await this.store.read();
    if (state.connection) return this.fetchPaired(state, state.connection);
    const candidates = [this.tokens?.refreshToken, state.refreshToken, this.credentials.refreshToken];
    for (const refreshToken of [...new Set(candidates)].filter((token): token is string => Boolean(token))) {
      try {
        return await this.accept(await this.idClient.refresh(MY_ITMO_CLIENT, refreshToken));
      } catch (error) {
        if (!(error instanceof CredentialRejectedError)) throw error;
      }
    }
    const authorization = await this.sso.authorize(MY_ITMO_CLIENT);
    return this.accept(await this.idClient.exchangeCode(MY_ITMO_CLIENT, authorization));
  }

  private async fetchPaired(state: AuthState, paired: Connection): Promise<TokenSet> {
    const session = paired.itmo;
    if (!session) throw new AuthError(NO_ITMO_SESSION);
    if (session.status === "closed") throw new AuthError(SESSION_CLOSED);

    if (state.refreshToken) {
      try {
        return await this.accept(await this.idClient.refresh(MY_ITMO_CLIENT, state.refreshToken));
      } catch (error) {
        if (!(error instanceof CredentialRejectedError)) throw error;
      }
    }

    const cookie = pairedCookie(state);
    if (cookie) {
      try {
        const minted = await tokensFromCookie(this.idClient, cookie, { sid: session.sid, isu: paired.isu });
        if (minted.keycloakIdentity !== cookie) await this.store.update({ keycloakIdentity: minted.keycloakIdentity });
        return await this.accept(minted.tokens);
      } catch (error) {
        if (!(error instanceof CredentialRejectedError)) throw error;
      }
    }

    this.tokens = undefined;
    await this.store.update({ connection: { ...paired, itmo: { ...session, status: "closed" } } });
    await this.onSessionClosed();
    throw new AuthError(SESSION_CLOSED);
  }

  private async accept(tokens: TokenSet): Promise<TokenSet> {
    this.tokens = tokens;
    if (tokens.refreshToken) await this.store.update({ refreshToken: tokens.refreshToken });
    return tokens;
  }
}
