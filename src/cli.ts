#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createToolDeps } from "./app.js";
import { StateStore } from "./auth/state-store.js";
import {
  type CommandContext,
  pairCommand,
  renewCommand,
  setupCommand,
  statusCommand,
  unpairCommand,
} from "./commands.js";
import { hasAnyCredentials, loadConfig } from "./config.js";
import { createHttpServer } from "./http-server.js";
import { createServer } from "./server.js";
import { VERSION } from "./version.js";

const HELP = `itmo-mcp ${VERSION}: MCP server for ITMO University (my.itmo.ru, bars.itmo.ru) and ITMO.Widgets

Usage:
  itmo-mcp [--stdio]           Serve MCP over stdio (for Claude Desktop, Claude Code, Cursor, ...)
  itmo-mcp --http [--port 8080] [--host 127.0.0.1]
                               Serve MCP over Streamable HTTP at /mcp (health check: /healthz)

Connecting through the ITMO.Widgets app (recommended):
  itmo-mcp pair [--name N] [--scopes reviews:read,links:read,sport:queue]
                               Show a QR for the app; the phone signs this server in to ITMO.ID
  itmo-mcp setup               pair, then add itmo-mcp to Claude Code, Codex and Cursor
  itmo-mcp status              Connection, scopes, ITMO session and its end date
  itmo-mcp renew               A new ITMO session for this connection (every 90 days at most)
  itmo-mcp unpair              End this server's ITMO session and disconnect

Credentials without pairing (environment):
  ITMO_REFRESH_TOKEN             my.itmo.ru refresh token (no BARS access)
  ITMO_KEYCLOAK_IDENTITY         KEYCLOAK_IDENTITY cookie of id.itmo.ru; the only way to BARS tools

Other settings:
  ITMO_MCP_STATE_DIR             Where tokens and the pairing are kept (default ~/.config/itmo-mcp)
  ITMO_MCP_ENABLE_WRITES         "true" adds tools that enroll, book and file requests (preview + confirm)
  ITMO_BROWSER_UA                "false" signs in to ITMO.ID as "ITMO Widgets MCP bot" instead of desktop Chrome
  ITMO_WIDGETS_URL               ITMO.Widgets server (default https://widgets.alllexey.dev)
  ITMO_MCP_HTTP_TOKEN            Require "Authorization: Bearer <token>" in HTTP mode
  ITMO_MCP_HTTP_ALLOWED_HOSTS    Comma-separated Host header values accepted in HTTP mode
`;

type PairOptions = { name?: string; scopes?: string[] };

const COMMANDS: Record<string, (context: CommandContext, options: PairOptions) => Promise<void>> = {
  pair: pairCommand,
  setup: setupCommand,
  status: (context) => statusCommand(context),
  renew: renewCommand,
  unpair: unpairCommand,
};

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      http: { type: "boolean", default: false },
      stdio: { type: "boolean", default: false },
      port: { type: "string", default: process.env.PORT ?? "8080" },
      host: { type: "string", default: "127.0.0.1" },
      name: { type: "string" },
      scopes: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
  });
  if (values.help) return void process.stdout.write(HELP);
  if (values.version) return void process.stdout.write(`${VERSION}\n`);
  if (values.http && values.stdio) throw new Error("Use either --http or --stdio");

  const config = loadConfig();
  const [command, ...rest] = positionals;
  if (command !== undefined) {
    const run = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined;
    if (!run || rest.length > 0) throw new Error(`Unknown command: ${positionals.join(" ")}. Run with --help.`);
    const context: CommandContext = { config, terminal: terminal() };
    const scopes = values.scopes?.split(",").map((scope) => scope.trim()).filter(Boolean);
    await run(context, { name: values.name, scopes });
    return;
  }

  const deps = createToolDeps(config);
  const { connection } = await new StateStore(config.stateDir).read();
  if (!connection && !hasAnyCredentials(config.credentials)) {
    console.error("itmo-mcp: not connected and no ITMO credentials; tools will return an error. Run `itmo-mcp pair`.");
  }

  await deps.availability?.refresh();
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

function terminal(): CommandContext["terminal"] {
  return {
    write: (text) => void process.stdout.write(text),
    async confirm(question) {
      if (!process.stdin.isTTY) return false;
      const readline = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return /^(y|yes|д|да)$/i.test((await readline.question(`${question} [y/N] `)).trim());
      } finally {
        readline.close();
      }
    },
  };
}

main().catch((error: unknown) => {
  console.error("itmo-mcp:", error instanceof Error ? error.message : error);
  process.exit(1);
});
