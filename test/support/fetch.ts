import type { FetchFn } from "../../src/http.js";

export interface RecordedCall {
  url: URL;
  method: string;
  headers: Headers;
  body: string;
}

export type Handler = (call: RecordedCall) => Response | Promise<Response>;

export function stubFetch(handler: Handler): FetchFn & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fn = async (input: string | URL | Request, init: RequestInit = {}) => {
    const call: RecordedCall =
      input instanceof Request
        ? { url: new URL(input.url), method: input.method, headers: input.headers, body: await input.text() }
        : {
            url: new URL(String(input)),
            method: init.method ?? "GET",
            headers: new Headers(init.headers),
            body: init.body === undefined || init.body === null ? "" : String(init.body),
          };
    calls.push(call);
    return handler(call);
  };
  return Object.assign(fn, { calls });
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

export function redirect(location: string, setCookies: string[] = []): Response {
  const headers = new Headers({ Location: location });
  for (const cookie of setCookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

export function html(body: string, setCookies: string[] = []): Response {
  const headers = new Headers({ "Content-Type": "text/html" });
  for (const cookie of setCookies) headers.append("Set-Cookie", cookie);
  return new Response(body, { status: 200, headers });
}

/** Fake access token with an `isu` claim. */
export function accessToken(isu = 123456, nonce = "a"): string {
  const payload = Buffer.from(JSON.stringify({ isu, nonce })).toString("base64url");
  return `eyJhbGciOiJub25lIn0.${payload}.sig`;
}
