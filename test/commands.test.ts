import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StateStore } from "../src/auth/state-store.js";
import { addToCursor, statusCommand, unpairCommand } from "../src/commands.js";
import { loadConfig } from "../src/config.js";
import { type Handler, stubFetch } from "./support/fetch.js";
import { notFound } from "./support/itmo-id.js";
import { fail, ok } from "./support/widgets.js";

const CONNECTION = {
  token: "iwc_x",
  id: "c",
  name: "laptop",
  isu: 123456,
  itmo: { sid: "sid", expiresAt: "2026-10-25T09:00:00Z", status: "ok" as const },
};

async function setup(handler: Handler) {
  const stateDir = mkdtempSync(join(tmpdir(), "itmo-mcp-cli-"));
  const store = new StateStore(stateDir);
  await store.update({ refreshToken: "paired", connection: CONNECTION });
  const fetchFn = stubFetch(handler);
  let output = "";
  const context = {
    config: loadConfig({ ITMO_MCP_STATE_DIR: stateDir, ITMO_WIDGETS_URL: "https://widgets.test/" }),
    terminal: { write: (text: string) => void (output += text), confirm: async () => false },
    fetchFn,
  };
  return { context, store, fetchFn, output: () => output };
}

const scope = (id: string, title: string, granted: boolean) => ({ scope: { id, title, description: "" }, granted });

describe("CLI commands", () => {
  it("status shows the connection, its scopes and a session about to end", async () => {
    const { context, output } = await setup(() =>
      ok({ isu: 123456, connection: { scopes: [scope("reviews:read", "Отзывы о преподавателях", true), scope("sport:queue", "Очереди", false)] } }),
    );

    await statusCommand(context, new Date("2026-10-22T09:00:00Z"));

    expect(output()).toContain("MCP «laptop», ISU 123456");
    expect(output()).toContain("работает до 25.10.2026 (осталось 3 дн., выполните itmo-mcp renew)");
    expect(output()).toContain("Доступы: Отзывы о преподавателях\n");
  });

  it("status after a revoke ends the ITMO session and wipes the pairing", async () => {
    const { context, store, fetchFn, output } = await setup((call) =>
      call.url.pathname.endsWith("/logout") ? new Response(null, { status: 204 }) : fail(401, "unauthorized"),
    );

    await statusCommand(context);

    expect(output()).toContain("Подключение отозвано");
    expect(fetchFn.calls.map((c) => c.url.pathname.split("/").pop())).toEqual(["me", "logout"]);
    expect(await store.read()).toEqual({});
  });

  it("unpair revokes the connection, ends the ITMO session and wipes everything", async () => {
    const { context, store, fetchFn, output } = await setup((call) => {
      if (call.method === "DELETE") return ok({});
      if (call.url.pathname.endsWith("/logout")) return new Response(null, { status: 204 });
      return notFound(call);
    });

    await unpairCommand(context);

    expect(fetchFn.calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      "DELETE /api/client/self",
      "POST /auth/realms/itmo/protocol/openid-connect/logout",
    ]);
    expect(new URLSearchParams(fetchFn.calls[1]!.body).get("refresh_token")).toBe("paired");
    expect(output()).toContain("Отключено");
    expect(await store.read()).toEqual({});
  });

  it("adds the server to Cursor's mcp.json and keeps other servers", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "itmo-mcp-cursor-")), "mcp.json");
    writeFileSync(file, JSON.stringify({ mcpServers: { other: { command: "x" } } }));

    await addToCursor(file, [["ITMO_MCP_STATE_DIR", "/s"]]);

    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      mcpServers: {
        other: { command: "x" },
        itmo: { command: "npx", args: ["-y", "itmo-mcp"], env: { ITMO_MCP_STATE_DIR: "/s" } },
      },
    });
  });
});
