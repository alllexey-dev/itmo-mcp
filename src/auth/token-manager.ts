import type { Credentials } from "../config.js";
import { AuthError, CredentialRejectedError } from "./errors.js";
import { isuFromAccessToken, type ItmoIdClient, MY_ITMO_CLIENT, type TokenSet } from "./itmo-id.js";
import type { SsoLogin } from "./sso.js";
import type { StateStore } from "./state-store.js";

const EXPIRY_SKEW_MS = 30_000;

export const SESSION_CLOSED =
  "The ITMO.ID session of this ITMO.Widgets connection has ended: run `itmo-mcp renew` and approve it on the phone";

/**
 * Access tokens for my.itmo.ru: refresh token first, then SSO login. Refreshes are single-flight.
 * A paired server uses only its own session: once ITMO.ID refuses it, the session is marked closed and
 * no further ITMO.ID calls are made until `itmo-mcp renew`.
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
    const paired = state.connection;
    if (paired?.itmo.status === "closed") throw new AuthError(SESSION_CLOSED);
    const candidates = paired
      ? [state.refreshToken]
      : [this.tokens?.refreshToken, state.refreshToken, this.credentials.refreshToken];
    const refreshTokens = [...new Set(candidates)].filter((token): token is string => Boolean(token));

    for (const refreshToken of refreshTokens) {
      try {
        return await this.accept(await this.idClient.refresh(MY_ITMO_CLIENT, refreshToken));
      } catch (error) {
        if (!(error instanceof CredentialRejectedError)) throw error;
      }
    }

    if (paired) {
      this.tokens = undefined;
      await this.store.update({ connection: { ...paired, itmo: { ...paired.itmo, status: "closed" } } });
      await this.onSessionClosed();
      throw new AuthError(SESSION_CLOSED);
    }

    const authorization = await this.sso.authorize(MY_ITMO_CLIENT);
    return this.accept(await this.idClient.exchangeCode(MY_ITMO_CLIENT, authorization));
  }

  private async accept(tokens: TokenSet): Promise<TokenSet> {
    this.tokens = tokens;
    if (tokens.refreshToken) await this.store.update({ refreshToken: tokens.refreshToken });
    return tokens;
  }
}
