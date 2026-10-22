import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const optionalText = z
  .string()
  .transform((value) => value.trim())
  .transform((value) => (value === "" ? undefined : value))
  .optional();

const EnvSchema = z.object({
  ITMO_REFRESH_TOKEN: optionalText,
  ITMO_KEYCLOAK_IDENTITY: optionalText,
  ITMO_MCP_STATE_DIR: optionalText,
  ITMO_MCP_HTTP_ALLOWED_HOSTS: optionalText,
  ITMO_MCP_HTTP_TOKEN: optionalText,
  ITMO_MCP_ENABLE_WRITES: optionalText,
  ITMO_BROWSER_UA: optionalText,
  ITMO_WIDGETS_URL: optionalText,
});

export interface Credentials {
  refreshToken?: string;
  keycloakIdentity?: string;
}

export interface Config {
  credentials: Credentials;
  stateDir: string;
  /** Exact Host header values accepted in HTTP mode (DNS rebinding protection). */
  allowedHosts: string[];
  /** Optional bearer token required in HTTP mode. */
  httpToken?: string;
  /** Registers tools that change data (enroll, book, submit). Off by default. */
  writesEnabled: boolean;
  /** Own ITMO.ID sign-ins look like desktop Chrome; false sends the honest `ITMO Widgets MCP bot` label. */
  browserUserAgent: boolean;
  /** ITMO.Widgets origin: pairing links and the Backend API under `/api`. */
  widgetsUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.parse(env);
  return {
    credentials: {
      refreshToken: parsed.ITMO_REFRESH_TOKEN,
      keycloakIdentity: parsed.ITMO_KEYCLOAK_IDENTITY,
    },
    stateDir: parsed.ITMO_MCP_STATE_DIR ?? join(homedir(), ".config", "itmo-mcp"),
    allowedHosts: (parsed.ITMO_MCP_HTTP_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim())
      .filter(Boolean),
    httpToken: parsed.ITMO_MCP_HTTP_TOKEN,
    writesEnabled: ["1", "true", "yes"].includes(parsed.ITMO_MCP_ENABLE_WRITES?.toLowerCase() ?? ""),
    browserUserAgent: !["0", "false", "no"].includes(parsed.ITMO_BROWSER_UA?.toLowerCase() ?? ""),
    widgetsUrl: (parsed.ITMO_WIDGETS_URL ?? "https://widgets.alllexey.dev").replace(/\/+$/, ""),
  };
}

export function hasAnyCredentials(credentials: Credentials): boolean {
  return Boolean(credentials.refreshToken || credentials.keycloakIdentity);
}
