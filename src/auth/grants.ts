import type { AuthState, Connection } from "./state-store.js";

/**
 * ITMO grants of an ITMO.Widgets connection (ITMO.Widgets ADR 0040): what the phone sealed for this server from
 * the ITMO.ID session it signed in for it. Any other `itmo:*` id is unknown to this version and ignored.
 */

/** The session's refresh token for my.itmo's OIDC client. */
export const ITMO_REFRESH_GRANT = "itmo:refresh:student-personal-cabinet";
/** The session's `KEYCLOAK_IDENTITY` cookie: every ITMO service as the user, BARS included. */
export const ITMO_SSO_GRANT = "itmo:sso";

export const KNOWN_ITMO_GRANTS: readonly string[] = [ITMO_REFRESH_GRANT, ITMO_SSO_GRANT];

/** ITMO grants the connection holds; a pairing made before protocol 2 holds the refresh token only. */
export function itmoGrantsOf(connection: Connection): string[] {
  return connection.itmoGrants ?? (connection.itmo ? [ITMO_REFRESH_GRANT] : []);
}

/** Whether the stored `keycloakIdentity` is the paired session's cookie (else it is a rotated env cookie). */
export function holdsPairedCookie(connection: Connection | undefined): connection is Connection {
  return Boolean(connection?.itmo && itmoGrantsOf(connection).includes(ITMO_SSO_GRANT));
}

/** The paired session's cookie, when this server holds one. */
export function pairedCookie(state: AuthState): string | undefined {
  return holdsPairedCookie(state.connection) ? state.keycloakIdentity : undefined;
}
