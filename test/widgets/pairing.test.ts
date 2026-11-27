import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ItmoIdClient } from "../../src/auth/itmo-id.js";
import { StateStore } from "../../src/auth/state-store.js";
import { WidgetsClient } from "../../src/widgets/client.js";
import { forgetConnection, pair, PairingError, renew } from "../../src/widgets/pairing.js";
import { type Handler, json, type RecordedCall, stubFetch } from "../support/fetch.js";
import { callback, isAuthorize, isToken, notFound, sessionTokenResponse, tokenResponse } from "../support/itmo-id.js";
import { ISU, ok, sealForLink } from "../support/widgets.js";

const CHALLENGE_ID = "00000000-0000-4000-8000-000000000501";
const NOW = new Date("2026-10-22T09:00:00Z");
const CONNECTION = { id: "00000000-0000-4000-8000-000000000601", client: "mcp", name: "laptop", scopes: [], itmoStatus: "ok" };

const bundle = (kind: string, patch: Record<string, unknown> = {}) => ({
  v: 1,
  challengeId: CHALLENGE_ID,
  kind,
  isu: ISU,
  issuedAt: "2026-10-22T08:59:30Z",
  itmo: { sid: `sid-${kind}`, expiresAt: "2027-01-20T09:00:00Z", refreshToken: `bundle-${kind}`, refreshExpiresAt: "2026-11-21T09:00:00Z" },
  ...patch,
});

/** Backend, ITMO.ID and the phone: the phone opens the link at the second claim and approves at the third. */
function world(
  options: {
    kind?: "CONNECT" | "RENEW";
    bundle?: Record<string, unknown>;
    /** The whole bundle the phone seals (null: no bundle at all), instead of the v1 one. */
    sealed?: unknown;
    refresh?: () => Response;
    /** id.itmo.ru authorize and token calls, instead of the refresh answer. */
    itmo?: Handler;
  } = {},
) {
  const kind = options.kind ?? "CONNECT";
  let link = "";
  let claims = 0;
  let shown = 0;
  const fetchFn = stubFetch(async (call: RecordedCall) => {
    const route = `${call.method} ${call.url.host}${call.url.pathname}`;
    if (options.itmo && (isToken(call) || isAuthorize(call))) return options.itmo(call);
    if (isToken(call)) return options.refresh?.() ?? tokenResponse("rotated");
    if (call.url.pathname.endsWith("/openid-connect/logout")) return new Response(null, { status: 204 });
    switch (route) {
      case "POST widgets.test/api/pair/challenges":
      case "POST widgets.test/api/client/pair/renew":
        return ok({ challengeId: CHALLENGE_ID, code: "K7Q2M9AB", claimSecret: "claim-secret", expiresAt: "2026-10-22T09:02:00Z" });
      case `POST widgets.test/api/pair/challenges/${CHALLENGE_ID}/claim`: {
        claims += 1;
        if (claims < 3) return ok({ status: claims === 1 ? "PENDING" : "OPENED", token: null, connection: null, sealedBundle: null }, 202);
        const plain = options.sealed !== undefined ? options.sealed : bundle(kind, options.bundle);
        const sealedBundle = plain === null ? null : await sealForLink(link, CHALLENGE_ID, kind, plain);
        const token = kind === "CONNECT" ? "iwc_new" : null;
        return ok({ status: "CLAIMED", token, connection: CONNECTION, sealedBundle });
      }
      case "GET widgets.test/api/client/me":
        return ok({ isu: ISU, connection: CONNECTION });
      case "PUT widgets.test/api/client/status":
      case "DELETE widgets.test/api/client/self":
        return ok({});
      default:
        return notFound(call);
    }
  });
  const store = new StateStore(mkdtempSync(join(tmpdir(), "itmo-mcp-pair-")));
  const idClient = new ItmoIdClient(fetchFn);
  const deps = {
    widgets: new WidgetsClient("https://widgets.test", undefined, fetchFn),
    idClient,
    store,
    origin: "https://widgets.test",
    view: {
      link: (value: string) => void (link = value),
      opened: () => void (shown += 1),
    },
    now: () => NOW,
    sleep: async () => undefined,
  };
  const routes = () => fetchFn.calls.map((c) => `${c.method} ${c.url.pathname.replace(CHALLENGE_ID, "{id}")}`);
  return { deps, store, fetchFn, routes, shown: () => shown, link: () => link };
}

describe("pair", () => {
  it("claims the token and the sealed session, checks it and keeps both in the 0600 state file", async () => {
    const { deps, store, fetchFn, routes, shown, link } = world();

    const connection = await pair(deps, { name: "laptop" });

    expect(link()).toMatch(/^https:\/\/widgets\.test\/pair#v1\.K7Q2M9AB\.[\w-]{43}\.[\w-]{22}$/);
    expect(shown()).toBe(1);
    const create = JSON.parse(fetchFn.calls[0]!.body);
    expect(create).toMatchObject({ kind: "CONNECT", client: "mcp", name: "laptop", keyCommitment: expect.any(String) });
    expect(fetchFn.calls[0]!.headers.get("x-client")).toMatch(/^kind=mcp; version=[^;]+; channel=github; source=alllexey-dev\/itmo-mcp; os=/);
    expect(routes()).toEqual([
      "POST /api/pair/challenges",
      "POST /api/pair/challenges/{id}/claim",
      "POST /api/pair/challenges/{id}/claim",
      "POST /api/pair/challenges/{id}/claim",
      "GET /api/client/me",
      "POST /auth/realms/itmo/protocol/openid-connect/token",
      "PUT /api/client/status",
    ]);
    expect(new URLSearchParams(fetchFn.calls[5]!.body).get("refresh_token")).toBe("bundle-CONNECT");
    expect(fetchFn.calls[4]!.headers.get("authorization")).toBe("Bearer iwc_new");
    expect(JSON.parse(fetchFn.calls[6]!.body)).toMatchObject({ itmo: "ok" });
    expect(connection).toEqual({
      token: "iwc_new",
      id: CONNECTION.id,
      name: "laptop",
      isu: ISU,
      itmo: { sid: "sid-CONNECT", expiresAt: "2027-01-20T09:00:00Z", refreshExpiresAt: "2026-11-21T09:00:00Z", status: "ok" },
    });
    expect(await store.read()).toEqual({ refreshToken: "rotated", connection });
    expect(statSync(join((store as unknown as { file: string }).file)).mode & 0o777).toBe(0o600);
  });

  it("ends a session of another account and revokes the new connection", async () => {
    const { deps, store, routes } = world({ bundle: { isu: 999999 } });

    await expect(pair(deps, { name: "laptop" })).rejects.toThrow(/другой аккаунт/);

    expect(routes().slice(-3)).toEqual([
      "POST /auth/realms/itmo/protocol/openid-connect/token",
      "POST /auth/realms/itmo/protocol/openid-connect/logout",
      "DELETE /api/client/self",
    ]);
    expect(await store.read()).toEqual({});
  });

  it("revokes the connection when ITMO.ID refuses the handed-over session", async () => {
    const { deps, routes } = world({ refresh: () => json({ error: "invalid_grant", error_description: "Session not active" }, 400) });

    await expect(pair(deps, { name: "laptop" })).rejects.toBeInstanceOf(PairingError);
    expect(routes().at(-1)).toBe("DELETE /api/client/self");
  });

  it("refuses to pair twice", async () => {
    const { deps, store } = world();
    await pair(deps, { name: "laptop" });

    await expect(pair(deps, { name: "laptop" })).rejects.toThrow(/Уже подключено/);
    expect((await store.read()).connection?.token).toBe("iwc_new");
  });
});

describe("renew and forget", () => {
  async function paired(kind: "RENEW" = "RENEW") {
    const w = world({ kind });
    await w.store.update({
      refreshToken: "old-refresh",
      connection: { token: "iwc_old", id: CONNECTION.id, name: "laptop", isu: ISU, itmo: { sid: "sid-old", expiresAt: "2026-10-30T00:00:00Z", status: "closed" } },
    });
    return w;
  }

  it("renew replaces the session, keeps the token and ends the old session", async () => {
    const { deps, store, fetchFn, routes } = await paired();

    await renew(deps);

    expect(routes()[0]).toBe("POST /api/client/pair/renew");
    expect(fetchFn.calls[0]!.headers.get("authorization")).toBe("Bearer iwc_old");
    expect(routes().slice(-3)).toEqual([
      "POST /auth/realms/itmo/protocol/openid-connect/token",
      "POST /auth/realms/itmo/protocol/openid-connect/logout",
      "PUT /api/client/status",
    ]);
    expect(new URLSearchParams(fetchFn.calls.at(-2)!.body).get("refresh_token")).toBe("old-refresh");
    expect(await store.read()).toMatchObject({
      refreshToken: "rotated",
      connection: { token: "iwc_old", itmo: { sid: "sid-RENEW", status: "ok" } },
    });
  });

  it("forgetConnection ends the own ITMO session and wipes the pairing, keeping env credentials", async () => {
    const { deps, store, fetchFn } = await paired();
    await store.update({ keycloakIdentity: "env-cookie" });

    expect(await forgetConnection(store, deps.idClient)).toBe(true);

    expect(fetchFn.calls.map((c) => c.url.pathname.split("/").pop())).toEqual(["logout"]);
    expect(new URLSearchParams(fetchFn.calls[0]!.body).get("refresh_token")).toBe("old-refresh");
    expect(await store.read()).toEqual({ keycloakIdentity: "env-cookie" });
    expect(await forgetConnection(store, deps.idClient)).toBe(false);
  });
});

const REFRESH = "itmo:refresh:student-personal-cabinet";

/** A protocol 2 bundle with the given ITMO items (`sid-2` session). */
const bundleV2 = (kind: string, items: { grant: string; value: string }[], patch: Record<string, unknown> = {}) => ({
  v: 2,
  challengeId: CHALLENGE_ID,
  kind,
  clientId: "itmo-mcp",
  isu: ISU,
  issuedAt: "2026-10-22T08:59:30Z",
  itmo: {
    sid: "sid-2",
    expiresAt: "2027-01-20T09:00:00Z",
    items: items.map((item) => ({ ...item, expiresAt: "2027-01-20T09:00:00Z" })),
  },
  ...patch,
});

const grantType = (call: RecordedCall) => new URLSearchParams(call.body).get("grant_type");

/** ITMO.ID where the cookie `cookie` signs in silently to session `sid` and rotates to `rotated-cookie`. */
const itmoWith = (sid: string, isu = ISU): Handler => (call) => {
  if (isAuthorize(call)) {
    if (call.headers.get("cookie") !== "KEYCLOAK_IDENTITY=cookie") return new Response("login page", { status: 200 });
    return callback(call, "the-code", ["KEYCLOAK_IDENTITY=rotated-cookie; Path=/auth/realms/itmo/"]);
  }
  return grantType(call) === "authorization_code"
    ? sessionTokenResponse(sid, "minted", isu)
    : sessionTokenResponse(sid, "rotated", isu);
};

describe("protocol 2 (--itmo-cookie)", () => {
  it("pair without the flag sends the protocol 1 request as before", async () => {
    const { deps, fetchFn } = world();

    await pair(deps, { name: "laptop", scopes: ["reviews:read"] });

    const create = JSON.parse(fetchFn.calls[0]!.body);
    expect(create).toEqual({
      kind: "CONNECT",
      client: "mcp",
      keyCommitment: expect.any(String),
      name: "laptop",
      version: expect.any(String),
      platform: expect.any(String),
      scopes: ["reviews:read"],
    });
  });

  it("pair --itmo-cookie asks for the scopes as widgets grants, then both ITMO grants, none required", async () => {
    const { deps, fetchFn } = world({
      sealed: bundleV2("CONNECT", [{ grant: "itmo:sso", value: "cookie" }]),
      itmo: itmoWith("sid-2"),
    });

    await pair(deps, { name: "laptop", itmoCookie: true });

    const create = JSON.parse(fetchFn.calls[0]!.body);
    expect(create).toEqual({
      kind: "CONNECT",
      clientId: "itmo-mcp",
      keyCommitment: expect.any(String),
      name: "laptop",
      version: expect.any(String),
      platform: expect.any(String),
      grants: [{ id: "widgets:reviews:read" }, { id: "widgets:links:read" }, { id: REFRESH }, { id: "itmo:sso" }],
    });
  });

  it("checks the cookie with one silent sign-in and keeps it with the minted refresh token", async () => {
    const { deps, store, fetchFn, routes } = world({
      sealed: bundleV2("CONNECT", [{ grant: "itmo:sso", value: "cookie" }]),
      itmo: itmoWith("sid-2"),
    });

    const connection = await pair(deps, { name: "laptop", itmoCookie: true, scopes: ["sport:queue"] });

    expect(JSON.parse(fetchFn.calls[0]!.body).grants[0]).toEqual({ id: "widgets:sport:queue" });
    expect(routes().slice(-4)).toEqual([
      "GET /api/client/me",
      "GET /auth/realms/itmo/protocol/openid-connect/auth",
      "POST /auth/realms/itmo/protocol/openid-connect/token",
      "PUT /api/client/status",
    ]);
    expect(new URL(fetchFn.calls.at(-3)!.url).searchParams.get("client_id")).toBe("student-personal-cabinet");
    expect(connection).toEqual({
      token: "iwc_new",
      id: CONNECTION.id,
      name: "laptop",
      isu: ISU,
      itmoGrants: ["itmo:sso"],
      itmo: { sid: "sid-2", expiresAt: "2027-01-20T09:00:00Z", status: "ok" },
    });
    expect(await store.read()).toEqual({ refreshToken: "minted", keycloakIdentity: "rotated-cookie", connection });
  });

  it("with both grants runs the refresh canary and the cookie check", async () => {
    const { deps, store } = world({
      sealed: bundleV2("CONNECT", [
        { grant: REFRESH, value: "bundle-refresh" },
        { grant: "itmo:sso", value: "cookie" },
      ]),
      itmo: itmoWith("sid-2"),
    });

    const connection = await pair(deps, { name: "laptop", itmoCookie: true });

    expect(connection.itmoGrants).toEqual([REFRESH, "itmo:sso"]);
    expect(await store.read()).toMatchObject({ refreshToken: "rotated", keycloakIdentity: "rotated-cookie" });
  });

  it("ends a cookie session with another sid, fails and revokes the connection", async () => {
    const { deps, store, fetchFn, routes } = world({
      sealed: bundleV2("CONNECT", [{ grant: "itmo:sso", value: "cookie" }]),
      itmo: itmoWith("sid-other"),
    });

    await expect(pair(deps, { name: "laptop", itmoCookie: true })).rejects.toThrow(PairingError);

    expect(routes().slice(-4)).toEqual([
      "GET /auth/realms/itmo/protocol/openid-connect/auth",
      "POST /auth/realms/itmo/protocol/openid-connect/token",
      "POST /auth/realms/itmo/protocol/openid-connect/logout",
      "DELETE /api/client/self",
    ]);
    expect(new URLSearchParams(fetchFn.calls.at(-2)!.body).get("refresh_token")).toBe("minted");
    expect(await store.read()).toEqual({});
  });

  it("ends a cookie session of another account", async () => {
    const { deps, store } = world({
      sealed: bundleV2("CONNECT", [{ grant: "itmo:sso", value: "cookie" }]),
      itmo: itmoWith("sid-2", 999999),
    });

    await expect(pair(deps, { name: "laptop", itmoCookie: true })).rejects.toThrow(/другой аккаунт/);
    expect(await store.read()).toEqual({});
  });

  it("without any ITMO grant connects for widgets_* tools only", async () => {
    const { deps, store, fetchFn, routes } = world({ sealed: null });
    await store.update({ refreshToken: "env-rotated" });

    const connection = await pair(deps, { name: "laptop", itmoCookie: true });

    expect(connection).toEqual({ token: "iwc_new", id: CONNECTION.id, name: "laptop", isu: ISU, itmoGrants: [] });
    expect(routes().some((route) => route.includes("openid-connect"))).toBe(false);
    expect(JSON.parse(fetchFn.calls.at(-1)!.body)).toMatchObject({ itmo: "none" });
    expect(await store.read()).toEqual({ connection });
  });

  it("protocol 1 still needs the sealed session", async () => {
    const { deps, routes } = world({ sealed: null });

    await expect(pair(deps, { name: "laptop" })).rejects.toThrow(/не передал вход/);
    expect(routes().at(-1)).toBe("DELETE /api/client/self");
  });

  it("renew sends the ITMO grants only with the flag and replaces the cookie session", async () => {
    const plain = world({ kind: "RENEW" });
    await plain.store.update({
      connection: { token: "iwc_old", id: CONNECTION.id, name: "laptop", isu: ISU, itmo: { sid: "sid-old", expiresAt: "2026-10-30T00:00:00Z", status: "ok" } },
    });
    await renew(plain.deps);
    expect(JSON.parse(plain.fetchFn.calls[0]!.body)).toEqual({ keyCommitment: expect.any(String) });

    const flagged = world({
      kind: "RENEW",
      sealed: bundleV2("RENEW", [{ grant: "itmo:sso", value: "cookie" }]),
      itmo: itmoWith("sid-2"),
    });
    await flagged.store.update({
      refreshToken: "old-refresh",
      keycloakIdentity: "env-cookie",
      connection: { token: "iwc_old", id: CONNECTION.id, name: "laptop", isu: ISU, itmo: { sid: "sid-old", expiresAt: "2026-10-30T00:00:00Z", status: "ok" } },
    });

    const connection = await renew(flagged.deps, { itmoCookie: true });

    expect(JSON.parse(flagged.fetchFn.calls[0]!.body)).toEqual({
      keyCommitment: expect.any(String),
      grants: [{ id: REFRESH }, { id: "itmo:sso" }],
    });
    expect(connection).toMatchObject({ itmoGrants: ["itmo:sso"], itmo: { sid: "sid-2", status: "ok" } });
    expect(flagged.routes().slice(-2)).toEqual(["POST /auth/realms/itmo/protocol/openid-connect/logout", "PUT /api/client/status"]);
    expect(new URLSearchParams(flagged.fetchFn.calls.at(-2)!.body).get("refresh_token")).toBe("old-refresh");
    expect(await flagged.store.read()).toMatchObject({ refreshToken: "minted", keycloakIdentity: "rotated-cookie" });
  });

  it("forgetConnection ends a cookie-only session with a minted refresh token and wipes the cookie", async () => {
    const { deps, store, fetchFn } = world({ itmo: itmoWith("sid-2") });
    await store.update({
      keycloakIdentity: "cookie",
      connection: {
        token: "iwc_x", id: CONNECTION.id, name: "laptop", isu: ISU, itmoGrants: ["itmo:sso"],
        itmo: { sid: "sid-2", expiresAt: "2027-01-20T09:00:00Z", status: "ok" },
      },
    });

    expect(await forgetConnection(store, deps.idClient)).toBe(true);

    expect(fetchFn.calls.map((c) => c.url.pathname.split("/").pop())).toEqual(["auth", "token", "logout"]);
    expect(new URLSearchParams(fetchFn.calls[2]!.body).get("refresh_token")).toBe("minted");
    expect(await store.read()).toEqual({});
  });
});
