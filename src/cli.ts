#!/usr/bin/env node
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createToolDeps } from "./app.js";
import { hasAnyCredentials, loadConfig } from "./config.js";
import { createHttpServer } from "./http-server.js";
import { createServer } from "./server.js";
import { VERSION } from "./version.js";

const HELP = `itmo-mcp ${VERSION}: MCP server for ITMO University (my.itmo.ru, bars.itmo.ru)

Usage:
  itmo-mcp [--stdio]           Serve MCP over stdio (for Claude Desktop, Claude Code, Cursor, ...)
  itmo-mcp --http [--port 8080] [--host 127.0.0.1]
                               Serve MCP over Streamable HTTP at /mcp (health check: /healthz)

Credentials (environment, at least one):
  ITMO_USERNAME, ITMO_PASSWORD   ITMO.ID login and password
  ITMO_KEYCLOAK_IDENTITY         KEYCLOAK_IDENTITY cookie of id.itmo.ru
  ITMO_REFRESH_TOKEN             my.itmo.ru refresh token (no BARS access)

Other settings:
  ITMO_MCP_STATE_DIR             Where rotated tokens are kept (default ~/.config/itmo-mcp)
  ITMO_MCP_ENABLE_WRITES         "true" adds tools that enroll, book and file requests (preview + confirm)
  ITMO_MCP_HTTP_TOKEN            Require "Authorization: Bearer <token>" in HTTP mode
  ITMO_MCP_HTTP_ALLOWED_HOSTS    Comma-separated Host header values accepted in HTTP mode
`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      http: { type: "boolean", default: false },
      stdio: { type: "boolean", default: false },
      port: { type: "string", default: process.env.PORT ?? "8080" },
      host: { type: "string", default: "127.0.0.1" },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
  });
  if (values.help) return void process.stdout.write(HELP);
  if (values.version) return void process.stdout.write(`${VERSION}\n`);
  if (values.http && values.stdio) throw new Error("Use either --http or --stdio");

  const config = loadConfig();
  if (!hasAnyCredentials(config.credentials)) {
    console.error("itmo-mcp: no ITMO credentials configured; tools will return an error. Run with --help.");
  }
  const deps = createToolDeps(config);

  if (!values.http) {
    await createServer(deps).connect(new StdioServerTransport());
    return;
  }

  const port = Number(values.port);
  if (!config.httpToken && values.host !== "127.0.0.1" && values.host !== "localhost") {
    console.error("itmo-mcp: warning: HTTP mode without ITMO_MCP_HTTP_TOKEN; put an authenticating proxy in front.");
  }
  createHttpServer(deps, { allowedHosts: config.allowedHosts, token: config.httpToken }).listen(port, values.host, () => {
    console.error(`itmo-mcp ${VERSION}: listening on http://${values.host}:${port}/mcp`);
  });
}

main().catch((error: unknown) => {
  console.error("itmo-mcp:", error instanceof Error ? error.message : error);
  process.exit(1);
});
