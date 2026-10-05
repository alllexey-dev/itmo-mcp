import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Credentials } from "../../src/config.js";
import { BarsSession } from "../../src/auth/bars-session.js";
import { AuthError } from "../../src/auth/errors.js";
import { ItmoIdClient } from "../../src/auth/itmo-id.js";
import { SsoLogin } from "../../src/auth/sso.js";
import { StateStore } from "../../src/auth/state-store.js";
import { type Handler, type RecordedCall, stubFetch } from "../support/fetch.js";
import { callback, isAuthorize, notFound } from "../support/itmo-id.js";

const isBarsLogin = (call: RecordedCall) => call.url.href.startsWith("https://bars.itmo.ru/backend/rest/login");

function barsLogin(call: RecordedCall, session = "Bearer bars-1"): Response {
  return new Response(null, { status: 200, headers: { authorization: `${session}-${call.url.searchParams.get("code")}` } });
}

function setup(handler: Handler, credentials: Credentials) {
  const fetchFn = stubFetch(handler);
  const store = new StateStore(mkdtempSync(join(tmpdir(), "itmo-mcp-test-")));
  const idClient = new ItmoIdClient(fetchFn);
  const session = new BarsSession(new SsoLogin(idClient, store, credentials), fetchFn);
  return { fetchFn, store, session };
}

describe("BarsSession", () => {
  it("logs in silently with KEYCLOAK_IDENTITY for the bars client", async () => {
    const { session, fetchFn, store } = setup(
      (call) => {
        if (isAuthorize(call)) return callback(call, "c1", ["KEYCLOAK_IDENTITY=rotated; Path=/"]);
        if (isBarsLogin(call)) return barsLogin(call);
        return notFound(call);
      },
      { keycloakIdentity: "sso" },
    );

    expect(await session.authorization()).toBe("Bearer bars-1-c1");
    const [authorize, login] = fetchFn.calls;
    expect(authorize!.url.searchParams.get("client_id")).toBe("bars");
    expect(login!.url.searchParams.get("customRedirectUri")).toBe("https://bars.itmo.ru/rest/login");
    expect(await store.read()).toEqual({ keycloakIdentity: "rotated" });
  });

  it("caches the session and logs in once for concurrent callers", async () => {
    const { session, fetchFn } = setup((call) => (isAuthorize(call) ? callback(call) : barsLogin(call)), {
      keycloakIdentity: "sso",
    });

    await Promise.all([session.authorization(), session.authorization()]);
    await session.authorization();

    expect(fetchFn.calls.filter(isBarsLogin)).toHaveLength(1);
  });

  it("logs in again after the session is invalidated", async () => {
    let n = 0;
    const { session } = setup(
      (call) => (isAuthorize(call) ? callback(call, `c${++n}`) : barsLogin(call)),
      { keycloakIdentity: "sso" },
    );

    const first = await session.authorization();
    session.invalidate("Bearer something-else");
    expect(await session.authorization()).toBe(first);
    session.invalidate(first);
    expect(await session.authorization()).toBe("Bearer bars-1-c2");
  });

  it("uses the password when there is no SSO cookie", async () => {
    let lastAuthorize: RecordedCall | undefined;
    const { session } = setup(
      (call) => {
        if (isAuthorize(call)) {
          lastAuthorize = call;
          return new Response(`"loginAction": "https://id.itmo.ru/login"`, { status: 200 });
        }
        if (call.url.pathname === "/login") return callback(lastAuthorize!, "pw");
        if (isBarsLogin(call)) return barsLogin(call);
        return notFound(call);
      },
      { username: "u", password: "p" },
    );

    expect(await session.authorization()).toBe("Bearer bars-1-pw");
  });

  it("fails when BARS returns no session header", async () => {
    const { session } = setup((call) => (isAuthorize(call) ? callback(call) : new Response(null, { status: 401 })), {
      keycloakIdentity: "sso",
    });

    await expect(session.authorization()).rejects.toThrow(/BARS login failed \(HTTP 401\)/);
  });

  it("requires SSO credentials (a refresh token alone cannot log in to BARS)", async () => {
    const { session } = setup(notFound, { refreshToken: "r" });

    await expect(session.authorization()).rejects.toBeInstanceOf(AuthError);
  });
});
