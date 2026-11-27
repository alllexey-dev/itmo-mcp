import { CredentialRejectedError } from "./errors.js";
import { isuFromAccessToken, type ItmoIdClient, MY_ITMO_CLIENT, sessionIdOfToken, type TokenSet } from "./itmo-id.js";

/** The cookie signed in to another ITMO.ID session or account than the one it was handed over for. */
export class SessionMismatchError extends CredentialRejectedError {
  constructor(readonly mismatch: "sid" | "isu") {
    super(
      mismatch === "sid"
        ? "The ITMO.ID cookie belongs to another session than the paired one"
        : "The ITMO.ID cookie belongs to another ITMO account",
    );
  }
}

/**
 * Tokens for my.itmo minted from the paired session's cookie: one silent authorize and the code exchange. The
 * tokens must carry the expected session id and ISU; otherwise the session they belong to is ended and
 * [SessionMismatchError] thrown. Returns the cookie as ITMO.ID left it (it may rotate).
 */
export async function tokensFromCookie(
  idClient: ItmoIdClient,
  cookie: string,
  expected: { sid: string; isu: number },
): Promise<{ tokens: TokenSet; keycloakIdentity: string }> {
  const authorization = await idClient.codeWithIdentity(MY_ITMO_CLIENT, cookie);
  const tokens = await idClient.exchangeCode(MY_ITMO_CLIENT, authorization);
  const mismatch =
    sessionIdOfToken(tokens.accessToken) !== expected.sid ? "sid" : isuFromAccessToken(tokens.accessToken) !== expected.isu ? "isu" : undefined;
  if (mismatch) {
    if (tokens.refreshToken) await idClient.logout(MY_ITMO_CLIENT, tokens.refreshToken).catch(() => undefined);
    throw new SessionMismatchError(mismatch);
  }
  return { tokens, keycloakIdentity: authorization.keycloakIdentity ?? cookie };
}

/**
 * Ends a paired ITMO.ID session with the OIDC logout: with its refresh token, or, when there is none or ITMO.ID
 * refused it, with a refresh token minted from its cookie. Best effort: never throws.
 */
export async function endSession(
  idClient: ItmoIdClient,
  credentials: { refreshToken?: string; keycloakIdentity?: string },
): Promise<void> {
  if (credentials.refreshToken) {
    try {
      await idClient.logout(MY_ITMO_CLIENT, credentials.refreshToken);
      return;
    } catch {
      // expired or unused for too long: the cookie may still reach the session
    }
  }
  if (!credentials.keycloakIdentity) return;
  try {
    const authorization = await idClient.codeWithIdentity(MY_ITMO_CLIENT, credentials.keycloakIdentity);
    const tokens = await idClient.exchangeCode(MY_ITMO_CLIENT, authorization);
    if (tokens.refreshToken) await idClient.logout(MY_ITMO_CLIENT, tokens.refreshToken);
  } catch {
    // the session is already over
  }
}
