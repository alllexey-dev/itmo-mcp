export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export const USER_AGENT = "itmo-mcp (+https://github.com/alllexey-dev/itmo-mcp)";

/** Collects `name=value` pairs from Set-Cookie headers, skipping cookies that are being deleted. */
export function readSetCookies(response: Response): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const header of response.headers.getSetCookie()) {
    const pair = header.split(";", 1)[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    const expired = /max-age=0\b/i.test(header) || /expires=thu, 01[- ]jan[- ]1970/i.test(header);
    if (value && !expired) cookies.set(name, value);
  }
  return cookies;
}

export function cookieHeader(cookies: Map<string, string>): string {
  return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
}

/** Fetch that attaches a credential and retries once with a fresh one when the server answers 401. */
export function authorizedFetch(
  fetchFn: FetchFn,
  credential: { current(): Promise<string>; rejected(value: string): Promise<string> },
  headers: Record<string, string> = {},
): (request: Request) => Promise<Response> {
  const send = (request: Request, authorization: string) => {
    const merged = new Headers(request.headers);
    merged.set("Authorization", authorization);
    merged.set("User-Agent", USER_AGENT);
    for (const [name, value] of Object.entries(headers)) merged.set(name, value);
    return fetchFn(new Request(request, { headers: merged }));
  };
  return async (request) => {
    const authorization = await credential.current();
    let response = await send(request.clone(), authorization);
    // ITMO services return sporadic 5xx; repeating a read is safe, repeating a write is not.
    if (response.status >= 500 && request.method === "GET") {
      await response.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      response = await send(request.clone(), authorization);
    }
    if (response.status !== 401) return response;
    await response.body?.cancel();
    return send(request, await credential.rejected(authorization));
  };
}

const RETRY_DELAY_MS = 300;
