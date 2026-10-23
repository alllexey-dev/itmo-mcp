import { arch } from "node:os";
import type { FetchFn } from "../http.js";
import { USER_AGENT } from "../http.js";
import { VERSION } from "../version.js";

/** ITMO.Widgets Backend answered with an error; `code` is the envelope's error code (`unauthorized`, ...). */
export class WidgetsApiError extends Error {
  override readonly name = "WidgetsApiError";

  constructor(
    readonly operation: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(`ITMO.Widgets ${operation} failed: HTTP ${status}${code ? `, ${code}` : ""}`);
  }
}

export class NotPairedError extends Error {
  override readonly name = "NotPairedError";
  constructor() {
    super("ITMO.Widgets is not connected: run `itmo-mcp pair` and approve it in the ITMO.Widgets app");
  }
}

export interface ScopeInfo {
  id: string;
  title: string;
  description: string;
}

export interface ConnectionInfo {
  id: string;
  client: string;
  name: string;
  scopes: { scope: ScopeInfo; granted: boolean }[];
  itmo?: { sid: string; expiresAt: string } | null;
  itmoStatus: "ok" | "closed" | "none";
  revokedAt?: string | null;
}

export interface CreatedChallenge {
  challengeId: string;
  code: string;
  claimSecret: string;
  expiresAt: string;
}

export interface PairingClaim {
  status: "PENDING" | "OPENED" | "CLAIMED";
  token?: string | null;
  connection?: ConnectionInfo | null;
  sealedBundle?: string | null;
}

export type ItmoHealth = "ok" | "closed" | "none";

/**
 * `X-Client` for ADR 0034: `kind=mcp`, this build and the OS as `<platform>-<arch>`. A release from this repository
 * is channel `github`; values keep only `[A-Za-z0-9._/+-]`.
 */
export function xClient(version = VERSION): string {
  const pairs = [
    ["kind", "mcp"],
    ["version", version],
    ["channel", "github"],
    ["source", "alllexey-dev/itmo-mcp"],
    ["os", `${process.platform}-${arch()}`],
  ];
  return pairs
    .map(([key, value]) => [key, value!.replace(/[^A-Za-z0-9._/+-]/g, "").slice(0, 64)])
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
}

/** The ITMO.Widgets API as an `mcp` connection: the anonymous pairing routes and the `iwc_` bearer routes. */
export class WidgetsClient {
  constructor(
    private readonly origin: string,
    /** The `iwc_` token, read per request so `renew` and `unpair` apply to a running server. */
    private readonly token: () => Promise<string | undefined> = async () => undefined,
    private readonly fetchFn: FetchFn = fetch,
    /** Called when Backend says the token is revoked (401), before the error is thrown. */
    private readonly onRevoked: () => Promise<void> = async () => undefined,
  ) {}

  withToken(token: string): WidgetsClient {
    return new WidgetsClient(this.origin, async () => token, this.fetchFn, this.onRevoked);
  }

  createChallenge(body: {
    keyCommitment: string;
    name: string;
    version: string;
    platform?: string;
    scopes?: string[];
  }): Promise<CreatedChallenge> {
    return this.call("createChallenge", "POST", "/api/pair/challenges", { kind: "CONNECT", client: "mcp", ...body }, false);
  }

  renew(keyCommitment: string): Promise<CreatedChallenge> {
    return this.call("renew", "POST", "/api/client/pair/renew", { keyCommitment });
  }

  claim(challengeId: string, claimSecret: string): Promise<PairingClaim> {
    const path = `/api/pair/challenges/${encodeURIComponent(challengeId)}/claim`;
    return this.call("claim", "POST", path, { claimSecret }, false);
  }

  me(): Promise<{ isu: number; connection: ConnectionInfo }> {
    return this.call("me", "GET", "/api/client/me");
  }

  async reportStatus(itmo: ItmoHealth): Promise<void> {
    await this.call("status", "PUT", "/api/client/status", { itmo, version: VERSION });
  }

  async revokeSelf(): Promise<void> {
    await this.call("revokeSelf", "DELETE", "/api/client/self");
  }

  get<T>(operation: string, path: string, query: Record<string, string | number | number[]> = {}): Promise<T> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      for (const item of Array.isArray(value) ? value : [value]) params.append(key, String(item));
    }
    return this.call(operation, "GET", params.size ? `${path}?${params}` : path);
  }

  post<T>(operation: string, path: string, body?: unknown): Promise<T> {
    return this.call(operation, "POST", path, body);
  }

  private async call<T>(operation: string, method: string, path: string, body?: unknown, auth = true): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json", "User-Agent": USER_AGENT, "X-Client": xClient() };
    if (auth) {
      const token = await this.token();
      if (!token) throw new NotPairedError();
      headers.Authorization = `Bearer ${token}`;
    }
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await this.fetchFn(`${this.origin}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const envelope = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      data?: T;
      error?: { code?: string } | null;
    };
    if (!response.ok || envelope.success === false) {
      const code = envelope.error?.code;
      if (auth && response.status === 401 && code !== "reauth_required") await this.onRevoked();
      throw new WidgetsApiError(operation, response.status, code);
    }
    return envelope.data as T;
  }
}
