import type { Credentials } from "../config.js";
import { AuthError, CredentialRejectedError } from "./errors.js";
import { isuFromAccessToken, type ItmoIdClient, MY_ITMO_CLIENT, type TokenSet } from "./itmo-id.js";
import type { SsoLogin } from "./sso.js";
import type { StateStore } from "./state-store.js";

const EXPIRY_SKEW_MS = 30_000;

/** Access tokens for my.itmo.ru: refresh token first, then SSO login. Refreshes are single-flight. */
export class TokenManager {
  private tokens: TokenSet | undefined;
  private pending: Promise<TokenSet> | undefined;

  constructor(
    private readonly idClient: ItmoIdClient,
    private readonly sso: SsoLogin,
    private readonly store: StateStore,
    private readonly credentials: Credentials,
    private readonly now: () => number = Date.now,
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
    const refreshTokens = [...new Set([this.tokens?.refreshToken, state.refreshToken, this.credentials.refreshToken])]
      .filter((token): token is string => Boolean(token));

    for (const refreshToken of refreshTokens) {
      try {
        return await this.accept(await this.idClient.refresh(MY_ITMO_CLIENT, refreshToken));
      } catch (error) {
        if (!(error instanceof CredentialRejectedError)) throw error;
      }
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
