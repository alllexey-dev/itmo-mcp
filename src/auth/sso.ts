import type { Credentials } from "../config.js";
import { AuthError, CredentialRejectedError } from "./errors.js";
import type { AuthorizationCode, ItmoIdClient, OidcClient } from "./itmo-id.js";
import type { StateStore } from "./state-store.js";

/**
 * Obtains authorization codes for any ITMO client from the strongest available SSO credential:
 * the stored KEYCLOAK_IDENTITY, then the one from env.
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
    const identities = unique([state.keycloakIdentity, this.credentials.keycloakIdentity]);
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
    throw new AuthError(
      identities.length > 0
        ? "ITMO.ID session expired: set a fresh ITMO_KEYCLOAK_IDENTITY"
        : "No ITMO.ID cookie: run `itmo-mcp pair` for my.itmo.ru, or set ITMO_KEYCLOAK_IDENTITY (also needed for BARS)",
    );
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
