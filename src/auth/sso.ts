import type { Credentials } from "../config.js";
import { AuthError, CredentialRejectedError } from "./errors.js";
import { type AuthorizationCode, BARS_CLIENT, type ItmoIdClient, type OidcClient } from "./itmo-id.js";
import { holdsPairedCookie } from "./grants.js";
import type { AuthState, StateStore } from "./state-store.js";

export const NO_CREDENTIALS =
  "No ITMO.ID sign-in: run `itmo-mcp pair` and approve it in the ITMO.Widgets app, or set ITMO_REFRESH_TOKEN or " +
  "ITMO_KEYCLOAK_IDENTITY (the cookie is also needed for BARS)";

export const NO_COOKIE =
  "No ITMO.ID cookie, so BARS is out of reach: BARS needs the grant itmo:sso (full ITMO.ID access). Run " +
  "`itmo-mcp renew --itmo-cookie` on a paired server (`itmo-mcp pair --itmo-cookie` on a new one) and turn on " +
  "«Полный доступ к ITMO.ID» on the phone, or set ITMO_KEYCLOAK_IDENTITY";

/**
 * The cookies SSO may use: a server paired with `itmo:sso` uses only its own session's cookie (none once that
 * session is closed); otherwise the stored rotated cookie, then the one from env.
 */
export function ssoIdentities(state: AuthState, envIdentity: string | undefined): string[] {
  if (holdsPairedCookie(state.connection)) {
    return state.connection.itmo?.status === "ok" && state.keycloakIdentity ? [state.keycloakIdentity] : [];
  }
  return unique([state.keycloakIdentity, envIdentity]);
}

/**
 * Obtains authorization codes for any ITMO client from the strongest available SSO credential:
 * the stored KEYCLOAK_IDENTITY, then the one from env; a server paired with `itmo:sso` only from its own session.
 * Rotated KEYCLOAK_IDENTITY values are persisted, so later logins stay silent.
 */
export class SsoLogin {
  constructor(
    private readonly idClient: ItmoIdClient,
    private readonly store: StateStore,
    private readonly credentials: Credentials,
    /** Called when ITMO.ID rejected every known cookie, before the error is thrown. */
    private readonly onRejected: () => Promise<void> = async () => undefined,
  ) {}

  async authorize(client: OidcClient): Promise<AuthorizationCode> {
    const state = await this.store.read();
    const paired = holdsPairedCookie(state.connection);
    const identities = ssoIdentities(state, this.credentials.keycloakIdentity);
    for (const identity of identities) {
      try {
        const authorization = await this.idClient.codeWithIdentity(client, identity);
        await this.remember(authorization, identity);
        return authorization;
      } catch (error) {
        if (!(error instanceof CredentialRejectedError)) throw error;
      }
    }

    if (identities.length > 0) await this.onRejected();
    if (paired) {
      throw new AuthError(
        "The ITMO.ID session of this ITMO.Widgets connection has ended: run `itmo-mcp renew --itmo-cookie` and approve it on the phone",
      );
    }
    if (identities.length > 0) throw new AuthError("ITMO.ID session expired: set a fresh ITMO_KEYCLOAK_IDENTITY");
    throw new AuthError(client.clientId === BARS_CLIENT.clientId ? NO_COOKIE : NO_CREDENTIALS);
  }

  private async remember(authorization: AuthorizationCode, used?: string): Promise<void> {
    if (authorization.keycloakIdentity && authorization.keycloakIdentity !== used) {
      await this.store.update({ keycloakIdentity: authorization.keycloakIdentity });
    }
  }
}

function unique(values: (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}
