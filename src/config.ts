import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const optionalText = z
  .string()
  .transform((value) => value.trim())
  .transform((value) => (value === "" ? undefined : value))
  .optional();

const EnvSchema = z.object({
  ITMO_USERNAME: optionalText,
  ITMO_PASSWORD: optionalText,
  ITMO_REFRESH_TOKEN: optionalText,
  ITMO_KEYCLOAK_IDENTITY: optionalText,
  ITMO_MCP_STATE_DIR: optionalText,
  ITMO_MCP_HTTP_ALLOWED_HOSTS: optionalText,
  ITMO_MCP_HTTP_TOKEN: optionalText,
});

export interface Credentials {
  username?: string;
  password?: string;
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
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.parse(env);
  return {
    credentials: {
      username: parsed.ITMO_USERNAME,
      password: parsed.ITMO_PASSWORD,
      refreshToken: parsed.ITMO_REFRESH_TOKEN,
      keycloakIdentity: parsed.ITMO_KEYCLOAK_IDENTITY,
    },
    stateDir: parsed.ITMO_MCP_STATE_DIR ?? join(homedir(), ".config", "itmo-mcp"),
    allowedHosts: (parsed.ITMO_MCP_HTTP_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim())
      .filter(Boolean),
    httpToken: parsed.ITMO_MCP_HTTP_TOKEN,
  };
}

export function hasAnyCredentials(credentials: Credentials): boolean {
  return Boolean(
    credentials.refreshToken || credentials.keycloakIdentity || (credentials.username && credentials.password),
  );
}
