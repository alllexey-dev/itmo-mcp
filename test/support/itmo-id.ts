import { json, redirect, type Handler, type RecordedCall, accessToken } from "./fetch.js";

/** Callback redirect for an authorize request, echoing its state. */
export function callback(call: RecordedCall, code = "the-code", setCookies: string[] = []): Response {
  const redirectUri = call.url.searchParams.get("redirect_uri") ?? "";
  const state = call.url.searchParams.get("state") ?? "";
  return redirect(`${redirectUri}?state=${state}&code=${code}`, setCookies);
}

export const isAuthorize = (call: RecordedCall) => call.url.pathname.endsWith("/openid-connect/auth");
export const isToken = (call: RecordedCall) => call.url.pathname.endsWith("/openid-connect/token");

export function tokenResponse(refreshToken = "refresh-2", nonce = "a"): Response {
  return json({ access_token: accessToken(123456, nonce), refresh_token: refreshToken, expires_in: 1800 });
}

export const invalidGrant = () => json({ error: "invalid_grant" }, 400);

export const notFound: Handler = (call) => new Response(`unexpected ${call.method} ${call.url}`, { status: 599 });

/** Fake access token of the ITMO.ID session `sid`. */
export function sessionToken(sid: string, isu = 123456): string {
  const payload = Buffer.from(JSON.stringify({ isu, sid })).toString("base64url");
  return `eyJhbGciOiJub25lIn0.${payload}.sig`;
}

/** Token response of a code exchange or refresh within the ITMO.ID session `sid`. */
export function sessionTokenResponse(sid: string, refreshToken: string, isu = 123456): Response {
  return json({ access_token: sessionToken(sid, isu), refresh_token: refreshToken, expires_in: 1800 });
}
