import { type FetchFn, USER_AGENT } from "../http.js";
import { AuthError } from "./errors.js";
import { BARS_CLIENT } from "./itmo-id.js";
import type { SsoLogin } from "./sso.js";

export const BARS_REST_URL = "https://bars.itmo.ru/backend/rest";

/** BARS session: the raw `authorization` header returned by `/login` after an ITMO.ID code exchange. */
export class BarsSession {
  private current: string | undefined;
  private pending: Promise<string> | undefined;

  constructor(
    private readonly sso: SsoLogin,
    private readonly fetchFn: FetchFn = fetch,
    private readonly restUrl: string = BARS_REST_URL,
  ) {}

  async authorization(): Promise<string> {
    if (this.current) return this.current;
    this.pending ??= this.login().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  /** Forgets the session after BARS rejected it; a newer session obtained meanwhile is kept. */
  invalidate(rejected: string): void {
    if (this.current === rejected) this.current = undefined;
  }

  private async login(): Promise<string> {
    const { code } = await this.sso.authorize(BARS_CLIENT);
    const params = new URLSearchParams({ code, customRedirectUri: BARS_CLIENT.redirectUri });
    const response = await this.fetchFn(`${this.restUrl}/login?${params}`, { headers: { "User-Agent": USER_AGENT } });
    const authorization = response.headers.get("authorization");
    if (!response.ok || !authorization?.startsWith("Bearer ")) {
      throw new AuthError(`BARS login failed (HTTP ${response.status})`);
    }
    this.current = authorization;
    return authorization;
  }
}
