import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ItmoIdClient } from "../../src/auth/itmo-id.js";
import { StateStore } from "../../src/auth/state-store.js";
import { WidgetsClient } from "../../src/widgets/client.js";
import { forgetConnection, pair, PairingError, renew } from "../../src/widgets/pairing.js";
import { json, type RecordedCall, stubFetch } from "../support/fetch.js";
import { isToken, notFound, tokenResponse } from "../support/itmo-id.js";
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
function world(options: { kind?: "CONNECT" | "RENEW"; bundle?: Record<string, unknown>; refresh?: () => Response } = {}) {
  const kind = options.kind ?? "CONNECT";
  let link = "";
  let claims = 0;
  const shown: string[] = [];
  const fetchFn = stubFetch(async (call: RecordedCall) => {
    const route = `${call.method} ${call.url.host}${call.url.pathname}`;
    if (isToken(call)) return options.refresh?.() ?? tokenResponse("rotated");
    if (call.url.pathname.endsWith("/openid-connect/logout")) return new Response(null, { status: 204 });
    switch (route) {
      case "POST widgets.test/api/pair/challenges":
      case "POST widgets.test/api/client/pair/renew":
        return ok({ challengeId: CHALLENGE_ID, code: "K7Q2M9AB", claimSecret: "claim-secret", expiresAt: "2026-10-22T09:02:00Z" });
      case `POST widgets.test/api/pair/challenges/${CHALLENGE_ID}/claim`: {
        claims += 1;
        if (claims < 3) return ok({ status: claims === 1 ? "PENDING" : "OPENED", token: null, connection: null, sealedBundle: null }, 202);
        const sealedBundle = await sealForLink(link, CHALLENGE_ID, kind, bundle(kind, options.bundle));
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
      opened: (code: string) => void shown.push(code),
    },
    now: () => NOW,
    sleep: async () => undefined,
  };
  const routes = () => fetchFn.calls.map((c) => `${c.method} ${c.url.pathname.replace(CHALLENGE_ID, "{id}")}`);
  return { deps, store, fetchFn, routes, shown, link: () => link };
}

describe("pair", () => {
  it("claims the token and the sealed session, checks it and keeps both in the 0600 state file", async () => {
    const { deps, store, fetchFn, routes, shown, link } = world();

    const connection = await pair(deps, { name: "laptop" });

    expect(link()).toMatch(/^https:\/\/widgets\.test\/pair#v1\.K7Q2M9AB\.[\w-]{43}\.[\w-]{22}$/);
    expect(shown).toEqual([expect.stringMatching(/^\d{3} \d{3}$/)]);
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
