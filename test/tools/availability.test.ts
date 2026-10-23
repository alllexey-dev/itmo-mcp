import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { StateStore } from "../../src/auth/state-store.js";
import { createBarsClient } from "../../src/clients/bars.js";
import { createMyItmoClient } from "../../src/clients/my-itmo.js";
import { createServer } from "../../src/server.js";
import { ToolAvailability } from "../../src/tools/availability.js";
import { WidgetsClient } from "../../src/widgets/client.js";
import { stubFetch } from "../support/fetch.js";

const CONNECTION = {
  token: "iwc_test", id: "c1", name: "hub", isu: 123456,
  itmo: { sid: "sid", expiresAt: "2027-01-21T00:00:00Z", status: "ok" as const },
};

async function listed(availability: ToolAvailability) {
  const fetchFn = stubFetch(() => new Response("{}"));
  const server = createServer({
    my: createMyItmoClient({ tokens: { accessToken: async () => "a", forceRefresh: async () => "a" }, fetchFn }),
    bars: createBarsClient({ session: { authorization: async () => "b", invalidate: () => undefined }, fetchFn }),
    widgets: new WidgetsClient("https://widgets.test", async () => "iwc_test", fetchFn),
    isu: async () => 123456,
    now: () => new Date(),
    availability,
  });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  let changes = 0;
  client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
    changes += 1;
  });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  const names = async () => (await client.listTools()).tools.map((tool) => tool.name);
  return { names, changes: () => changes };
}

function store() {
  return new StateStore(mkdtempSync(join(tmpdir(), "itmo-mcp-availability-")));
}

describe("tool availability", () => {
  it("lists no BARS or ITMO.Widgets tools without a cookie or a pairing", async () => {
    const availability = new ToolAvailability(store());
    await availability.refresh();

    const names = await (await listed(availability)).names();

    expect(names).toContain("itmo_get_schedule");
    expect(names.filter((name) => name.startsWith("bars_") || name.startsWith("widgets_"))).toEqual([]);
  });

  it("lists BARS with an env cookie and ITMO.Widgets with a pairing", async () => {
    const state = store();
    await state.update({ connection: CONNECTION });
    const availability = new ToolAvailability(state, "env-cookie");
    await availability.refresh();

    const names = await (await listed(availability)).names();

    expect(names).toContain("bars_get_scores");
    expect(names).toContain("widgets_get_teacher_reviews");
  });

  it("hides BARS once ITMO.ID rejects the cookie and shows it again for a new one", async () => {
    const state = store();
    const availability = new ToolAvailability(state, "env-cookie");
    await availability.refresh();
    const client = await listed(availability);

    await availability.identitiesRejected();
    const hidden = await client.names();
    await state.update({ keycloakIdentity: "fresh-cookie" });
    await availability.refresh();
    const shown = await client.names();

    expect(hidden).not.toContain("bars_get_scores");
    expect(shown).toContain("bars_get_scores");
    expect(client.changes()).toBeGreaterThanOrEqual(2);
  });

  it("keeps every tool for a server built without availability", async () => {
    const availability = new ToolAvailability(store());

    const names = await (await listed(availability)).names();

    expect(names).toContain("bars_get_scores");
    expect(names).toContain("widgets_get_teacher_reviews");
  });
});
