/** Authentication cannot proceed; the message is safe to show to the user and never contains secrets. */
export class AuthError extends Error {
  override readonly name = "AuthError";
}

/** ITMO.ID answered, but rejected the credential that was tried. */
export class CredentialRejectedError extends AuthError {}
