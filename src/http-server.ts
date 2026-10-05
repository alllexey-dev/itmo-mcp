import { timingSafeEqual } from "node:crypto";
import { createServer as createNodeServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";
import type { ToolDeps } from "./tools/deps.js";

export interface HttpOptions {
  allowedHosts: string[];
  token?: string;
}

/**
 * Stateless Streamable HTTP endpoint at POST /mcp (a fresh MCP server per request, shared ITMO session)
 * and GET /healthz. Authentication is either an optional bearer token or a reverse proxy in front.
 */
export function createHttpServer(deps: ToolDeps, options: HttpOptions): Server {
  return createHttpServerWith(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path === "/healthz") return send(res, 200, { status: "ok" });
    if (path !== "/mcp") return send(res, 404, { error: "Not found" });
    if (options.token && !authorized(req, options.token)) return send(res, 401, { error: "Unauthorized" });
    if (req.method !== "POST") return send(res, 405, { error: "Method not allowed: this server is stateless, use POST" });

    const server = createServer(deps);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      enableDnsRebindingProtection: options.allowedHosts.length > 0,
      allowedHosts: options.allowedHosts,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });
}

function createHttpServerWith(handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>): Server {
  return createNodeServer((req, res) => {
    handler(req, res).catch((error: unknown) => {
      console.error("itmo-mcp: request failed:", error instanceof Error ? error.message : error);
      if (!res.headersSent) send(res, 500, { error: "Internal server error" });
      else res.end();
    });
  });
}

function authorized(req: IncomingMessage, token: string): boolean {
  const given = Buffer.from(req.headers.authorization ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
}
