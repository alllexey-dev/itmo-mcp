import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Credentials } from "../../src/config.js";
import { AuthError } from "../../src/auth/errors.js";
import { BARS_CLIENT, ItmoIdClient } from "../../src/auth/itmo-id.js";
import { SsoLogin } from "../../src/auth/sso.js";
import { StateStore } from "../../src/auth/state-store.js";
import { TokenManager } from "../../src/auth/token-manager.js";
import { type Handler, json, type RecordedCall, stubFetch } from "../support/fetch.js";
import {
  callback,
  invalidGrant,
  isAuthorize,
  isToken,
  notFound,
  sessionTokenResponse,
  tokenResponse,
} from "../support/itmo-id.js";

function setup(handler: Handler, credentials: Credentials, now = () => 0) {
  const fetchFn = stubFetch(handler);
  const store = new StateStore(mkdtempSync(join(tmpdir(), "itmo-mcp-test-")));
  const idClient = new ItmoIdClient(fetchFn, undefined, now);
  const closed: string[] = [];
  const sso = new SsoLogin(idClient, store, credentials);
  const tokens = new TokenManager(idClient, sso, store, credentials, now, async () => void closed.push("closed"));
  return { fetchFn, store, tokens, closed };
}

const CONNECTION = {
  token: "iwc_x",
  id: "c",
  name: "laptop",
  isu: 123456,
  itmo: { sid: "sid", expiresAt: "2027-01-01T00:00:00Z", status: "ok" as const },
};

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
    await expect(tokens.accessToken()).rejects.toThrow(/itmo-mcp pair/);
  });

  it("reads the ISU number from the token", async () => {
    const { tokens } = setup(() => tokenResponse(), { refreshToken: "r" });

    expect(await tokens.isu()).toBe(123456);
  });

  describe("paired with ITMO.Widgets", () => {
    it("uses only the paired session, never env credentials", async () => {
      const { tokens, store, fetchFn } = setup((call) => (isToken(call) ? tokenResponse("rotated") : notFound(call)), {
        refreshToken: "env-refresh",
        keycloakIdentity: "env-cookie",
      });
      await store.update({ refreshToken: "paired", connection: CONNECTION });

      await tokens.accessToken();

      expect(fetchFn.calls.map((c) => new URLSearchParams(c.body).get("refresh_token"))).toEqual(["paired"]);
      expect(await store.read()).toMatchObject({ refreshToken: "rotated", connection: CONNECTION });
    });

    it("marks the session closed on invalid_grant, reports it once and stops calling ITMO.ID", async () => {
      const { tokens, store, fetchFn, closed } = setup(
        (call) => (isToken(call) ? json({ error: "invalid_grant", error_description: "Session not active" }, 400) : notFound(call)),
        { keycloakIdentity: "env-cookie" },
      );
      await store.update({ refreshToken: "paired", connection: CONNECTION });

      await expect(tokens.accessToken()).rejects.toThrow(/itmo-mcp renew/);
      await expect(tokens.accessToken()).rejects.toThrow(/itmo-mcp renew/);

      expect(fetchFn.calls).toHaveLength(1);
      expect(closed).toEqual(["closed"]);
      expect((await store.read()).connection?.itmo?.status).toBe("closed");
    });

    const SSO_CONNECTION = { ...CONNECTION, itmoGrants: ["itmo:sso"] };
    const isCookie = (call: RecordedCall) => call.headers.get("cookie") === "KEYCLOAK_IDENTITY=paired-cookie";

    it("falls back to the paired cookie once the refresh token is refused, checking the session id", async () => {
      const { tokens, store, fetchFn, closed } = setup(
        (call) => {
          if (isAuthorize(call)) return isCookie(call) ? callback(call, "code", ["KEYCLOAK_IDENTITY=rotated; Path=/"]) : notFound(call);
          return grant(call) === "refresh_token" ? invalidGrant() : sessionTokenResponse("sid", "minted");
        },
        { keycloakIdentity: "env-cookie", refreshToken: "env-refresh" },
      );
      await store.update({ refreshToken: "paired", keycloakIdentity: "paired-cookie", connection: SSO_CONNECTION });

      await tokens.accessToken();

      expect(fetchFn.calls.map((c) => (isAuthorize(c) ? "authorize" : grant(c)))).toEqual([
        "refresh_token",
        "authorize",
        "authorization_code",
      ]);
      expect(closed).toEqual([]);
      expect(await store.read()).toMatchObject({ refreshToken: "minted", keycloakIdentity: "rotated", connection: SSO_CONNECTION });
    });

    it("ends a session of another sid reached with the cookie and marks the paired one closed", async () => {
      const { tokens, store, fetchFn, closed } = setup((call) => {
        if (isAuthorize(call)) return callback(call);
        if (call.url.pathname.endsWith("/logout")) return new Response(null, { status: 204 });
        return grant(call) === "refresh_token" ? invalidGrant() : sessionTokenResponse("sid-other", "minted");
      }, {});
      await store.update({ refreshToken: "paired", keycloakIdentity: "paired-cookie", connection: SSO_CONNECTION });

      await expect(tokens.accessToken()).rejects.toThrow(/itmo-mcp renew/);

      expect(fetchFn.calls.map((c) => c.url.pathname.split("/").pop())).toEqual(["token", "auth", "token", "logout"]);
      expect(closed).toEqual(["closed"]);
      expect((await store.read()).connection?.itmo?.status).toBe("closed");
    });

    it("never uses a stored cookie the connection was not granted", async () => {
      const { tokens, store, fetchFn } = setup(() => invalidGrant(), {});
      await store.update({ refreshToken: "paired", keycloakIdentity: "env-rotated", connection: CONNECTION });

      await expect(tokens.accessToken()).rejects.toThrow(/itmo-mcp renew/);
      expect(fetchFn.calls.filter(isAuthorize)).toEqual([]);
    });

    it("explains the missing grant when the phone handed over no ITMO session", async () => {
      const { tokens, store, fetchFn } = setup(notFound, { refreshToken: "env-refresh" });
      await store.update({ connection: { token: "iwc_x", id: "c", name: "laptop", isu: 123456, itmoGrants: [] } });

      await expect(tokens.accessToken()).rejects.toThrow(/itmo:refresh:student-personal-cabinet.*itmo-mcp renew/);
      expect(fetchFn.calls).toEqual([]);
    });
  });
});

describe("SsoLogin", () => {
  function sso(credentials: Credentials) {
    const fetchFn = stubFetch((call) => (isAuthorize(call) ? callback(call) : notFound(call)));
    const store = new StateStore(mkdtempSync(join(tmpdir(), "itmo-mcp-sso-")));
    return { fetchFn, store, login: new SsoLogin(new ItmoIdClient(fetchFn), store, credentials) };
  }

  it("a server paired with itmo:sso signs in only with its own cookie", async () => {
    const { fetchFn, store, login } = sso({ keycloakIdentity: "env-cookie" });
    await store.update({ keycloakIdentity: "paired-cookie", connection: { ...CONNECTION, itmoGrants: ["itmo:sso"] } });

    await login.authorize(BARS_CLIENT);

    expect(fetchFn.calls.map((c) => c.headers.get("cookie"))).toEqual(["KEYCLOAK_IDENTITY=paired-cookie"]);
  });

  it("a paired server without itmo:sso keeps the env cookie for BARS", async () => {
    const { fetchFn, store, login } = sso({ keycloakIdentity: "env-cookie" });
    await store.update({ refreshToken: "paired", connection: CONNECTION });

    await login.authorize(BARS_CLIENT);

    expect(fetchFn.calls.map((c) => c.headers.get("cookie"))).toEqual(["KEYCLOAK_IDENTITY=env-cookie"]);
  });

  it("names the grant BARS needs when there is no cookie", async () => {
    const { store, login } = sso({});
    await store.update({ refreshToken: "paired", connection: CONNECTION });

    await expect(login.authorize(BARS_CLIENT)).rejects.toThrow(/itmo:sso.*itmo-mcp renew --itmo-cookie/);
  });
});
