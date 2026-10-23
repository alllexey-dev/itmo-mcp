import { createHash, randomBytes } from "node:crypto";
import { type FetchFn, readSetCookies, USER_AGENT } from "../http.js";
import { AuthError, CredentialRejectedError } from "./errors.js";

export const ITMO_ID_ISSUER = "https://id.itmo.ru/auth/realms/itmo";

/** Public OIDC client registered in the `itmo` realm; only these exact redirect URIs are accepted. */
export interface OidcClient {
  clientId: string;
  redirectUri: string;
  scope: string;
  pkce: boolean;
}

export const MY_ITMO_CLIENT: OidcClient = {
  clientId: "student-personal-cabinet",
  redirectUri: "https://my.itmo.ru/login/callback",
  scope: "openid profile",
  pkce: true,
};

export const BARS_CLIENT: OidcClient = {
  clientId: "bars",
  redirectUri: "https://bars.itmo.ru/rest/login",
  scope: "openid",
  pkce: false,
};

export interface AuthorizationCode {
  code: string;
  verifier?: string;
  /** SSO cookie issued or rotated by Keycloak during this authorization. */
  keycloakIdentity?: string;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

const IDENTITY_COOKIE = "KEYCLOAK_IDENTITY";

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export class ItmoIdClient {
  constructor(
    private readonly fetchFn: FetchFn = fetch,
    private readonly issuer: string = ITMO_ID_ISSUER,
    private readonly now: () => number = Date.now,
    /** Sent to id.itmo.ru; the UA of a sign-in labels the session on id.itmo.ru/activity. */
    private readonly userAgent: string = USER_AGENT,
  ) {}

  /** Silent SSO: one authorize request with the KEYCLOAK_IDENTITY cookie, no redirects followed. */
  async codeWithIdentity(client: OidcClient, keycloakIdentity: string): Promise<AuthorizationCode> {
    const { url, state, verifier } = this.authorizeRequest(client);
    const response = await this.fetchFn(url, {
      headers: { Cookie: `${IDENTITY_COOKIE}=${keycloakIdentity}`, "User-Agent": this.userAgent },
      redirect: "manual",
    });
    const rotated = readSetCookies(response).get(IDENTITY_COOKIE);
    const code = this.codeFromRedirect(client, response, state);
    if (!code) throw new CredentialRejectedError("ITMO.ID session (KEYCLOAK_IDENTITY) is expired or invalid");
    return { code, verifier, keycloakIdentity: rotated ?? keycloakIdentity };
  }

  async exchangeCode(client: OidcClient, authorization: AuthorizationCode): Promise<TokenSet> {
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: client.clientId,
      redirect_uri: client.redirectUri,
      code: authorization.code,
    });
    if (authorization.verifier) form.set("code_verifier", authorization.verifier);
    return this.tokenRequest(form, "authorization code");
  }

  async refresh(client: OidcClient, refreshToken: string): Promise<TokenSet> {
    const form = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: client.clientId,
      refresh_token: refreshToken,
    });
    return this.tokenRequest(form, "refresh token");
  }

  /** OIDC logout with a refresh token: ends exactly that token's ITMO.ID session (204); other sessions live. */
  async logout(client: OidcClient, refreshToken: string): Promise<void> {
    const response = await this.fetchFn(`${this.issuer}/protocol/openid-connect/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": this.userAgent },
      body: new URLSearchParams({ client_id: client.clientId, refresh_token: refreshToken }),
    });
    await response.body?.cancel();
    if (!response.ok) throw new AuthError(`ITMO.ID logout failed (HTTP ${response.status})`);
  }

  private authorizeRequest(client: OidcClient): { url: string; state: string; verifier?: string } {
    const state = randomBytes(12).toString("base64url");
    const params = new URLSearchParams({
      response_type: "code",
      client_id: client.clientId,
      redirect_uri: client.redirectUri,
      scope: client.scope,
      state,
    });
    let verifier: string | undefined;
    if (client.pkce) {
      const pair = pkcePair();
      verifier = pair.verifier;
      params.set("code_challenge_method", "S256");
      params.set("code_challenge", pair.challenge);
    }
    return { url: `${this.issuer}/protocol/openid-connect/auth?${params}`, state, verifier };
  }

  /** Returns the code from a redirect to the client's callback; undefined when Keycloak wants a login page. */
  private codeFromRedirect(client: OidcClient, response: Response, state: string): string | undefined {
    if (response.status < 300 || response.status >= 400) return undefined;
    const location = response.headers.get("location");
    if (!location) return undefined;
    const target = new URL(location, this.issuer);
    if (`${target.origin}${target.pathname}` !== client.redirectUri) return undefined;
    const error = target.searchParams.get("error");
    if (error) throw new AuthError(`ITMO.ID returned ${error} for client ${client.clientId}`);
    if (target.searchParams.get("state") !== state) throw new AuthError("ITMO.ID returned a mismatched state");
    return target.searchParams.get("code") ?? undefined;
  }

  private async tokenRequest(form: URLSearchParams, grant: string): Promise<TokenSet> {
    const response = await this.fetchFn(`${this.issuer}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": this.userAgent },
      body: form,
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || typeof body.access_token !== "string") {
      const error = typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
      const description = typeof body.error_description === "string" ? `: ${body.error_description.slice(0, 100)}` : "";
      if (error === "invalid_grant") {
        throw new CredentialRejectedError(`ITMO.ID rejected the ${grant} (${error}${description})`);
      }
      throw new AuthError(`ITMO.ID token request failed (${error})`);
    }
    return {
      accessToken: body.access_token,
      refreshToken: String(body.refresh_token ?? ""),
      expiresAt: this.now() + Number(body.expires_in ?? 300) * 1000,
    };
  }
}

/** Reads the `isu` claim from an ITMO.ID access token without verifying it (the token came from ITMO.ID directly). */
export function isuFromAccessToken(accessToken: string): number | undefined {
  const payload = accessToken.split(".")[1];
  if (!payload) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { isu?: unknown };
    const isu = Number(claims.isu);
    return Number.isSafeInteger(isu) && isu > 0 ? isu : undefined;
  } catch {
    return undefined;
  }
}
