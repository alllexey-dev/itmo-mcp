import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Credentials } from "../../src/config.js";
import { AuthError } from "../../src/auth/errors.js";
import { ItmoIdClient } from "../../src/auth/itmo-id.js";
import { SsoLogin } from "../../src/auth/sso.js";
import { StateStore } from "../../src/auth/state-store.js";
import { TokenManager } from "../../src/auth/token-manager.js";
import { type Handler, stubFetch } from "../support/fetch.js";
import { callback, invalidGrant, isAuthorize, isToken, notFound, tokenResponse } from "../support/itmo-id.js";

function setup(handler: Handler, credentials: Credentials, now = () => 0) {
  const fetchFn = stubFetch(handler);
  const store = new StateStore(mkdtempSync(join(tmpdir(), "itmo-mcp-test-")));
  const idClient = new ItmoIdClient(fetchFn, undefined, now);
  const tokens = new TokenManager(idClient, new SsoLogin(idClient, store, credentials), store, credentials, now);
  return { fetchFn, store, tokens };
}

const grant = (call: { body: string }) => new URLSearchParams(call.body).get("grant_type");

describe("TokenManager", () => {
  it("uses the env refresh token and persists the rotated one", async () => {
    const { tokens, store, fetchFn } = setup((call) => (isToken(call) ? tokenResponse("rotated") : notFound(call)), {
      refreshToken: "env-refresh",
    });

    await tokens.accessToken();

    expect(new URLSearchParams(fetchFn.calls[0]!.body).get("refresh_token")).toBe("env-refresh");
    expect(await store.read()).toEqual({ refreshToken: "rotated" });
  });

  it("prefers the stored refresh token over env", async () => {
    const { tokens, store, fetchFn } = setup((call) => (isToken(call) ? tokenResponse() : notFound(call)), {
      refreshToken: "env-refresh",
    });
    await store.update({ refreshToken: "stored" });

    await tokens.accessToken();

    expect(new URLSearchParams(fetchFn.calls[0]!.body).get("refresh_token")).toBe("stored");
  });

  it("falls back to SSO login when refresh tokens are rejected", async () => {
    const { tokens, store, fetchFn } = setup(
      (call) => {
        if (isToken(call)) return grant(call) === "refresh_token" ? invalidGrant() : tokenResponse("from-code");
        if (isAuthorize(call)) return callback(call, "code", ["KEYCLOAK_IDENTITY=rotated; Path=/"]);
        return notFound(call);
      },
      { refreshToken: "dead", keycloakIdentity: "sso" },
    );

    await tokens.accessToken();

    expect(fetchFn.calls.map((c) => (isAuthorize(c) ? "authorize" : grant(c)))).toEqual([
      "refresh_token",
      "authorize",
      "authorization_code",
    ]);
    expect(await store.read()).toEqual({ refreshToken: "from-code", keycloakIdentity: "rotated" });
  });

  it("falls back to the password when the SSO cookie is expired", async () => {
    let lastAuthorize: Parameters<typeof callback>[0] | undefined;
    const { tokens, store, fetchFn } = setup(
      (call) => {
        if (isToken(call)) return tokenResponse("from-password");
        if (isAuthorize(call)) {
          lastAuthorize = call;
          return new Response(`"loginAction": "https://id.itmo.ru/login"`, { status: 200 });
        }
        if (call.url.pathname === "/login") return callback(lastAuthorize!, "pw", ["KEYCLOAK_IDENTITY=new; Path=/"]);
        return notFound(call);
      },
      { keycloakIdentity: "expired", username: "u", password: "p" },
    );

    await tokens.accessToken();

    expect(fetchFn.calls.map((c) => `${c.method} ${c.url.pathname.split("/").pop()}`)).toEqual([
      "GET auth",
      "GET auth",
      "POST login",
      "POST token",
    ]);
    expect(await store.read()).toEqual({ refreshToken: "from-password", keycloakIdentity: "new" });
  });

  it("caches the access token until shortly before expiry", async () => {
    let time = 0;
    const { tokens, fetchFn } = setup(() => tokenResponse("r", String(fetchFn.calls.length)), { refreshToken: "r" }, () => time);

    const first = await tokens.accessToken();
    time = 1800_000 - 31_000;
    const cached = await tokens.accessToken();
    time = 1800_000 - 29_000;
    const renewed = await tokens.accessToken();

    expect(cached).toBe(first);
    expect(renewed).not.toBe(first);
    expect(fetchFn.calls).toHaveLength(2);
  });

  it("refreshes once for concurrent callers", async () => {
    const { tokens, fetchFn } = setup(() => tokenResponse(), { refreshToken: "r" });

    await Promise.all([tokens.accessToken(), tokens.accessToken(), tokens.forceRefresh()]);

    expect(fetchFn.calls).toHaveLength(1);
  });

  it("explains which env variables are missing", async () => {
    const { tokens } = setup(notFound, {});

    await expect(tokens.accessToken()).rejects.toThrow(AuthError);
    await expect(tokens.accessToken()).rejects.toThrow(/ITMO_USERNAME/);
  });

  it("reads the ISU number from the token", async () => {
    const { tokens } = setup(() => tokenResponse(), { refreshToken: "r" });

    expect(await tokens.isu()).toBe(123456);
  });
});
