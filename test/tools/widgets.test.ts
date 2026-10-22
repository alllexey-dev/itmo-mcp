import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createBarsClient } from "../../src/clients/bars.js";
import { createMyItmoClient } from "../../src/clients/my-itmo.js";
import { createServer } from "../../src/server.js";
import { PendingActions } from "../../src/tools/actions.js";
import { periodKey } from "../../src/tools/widgets.js";
import { WidgetsClient } from "../../src/widgets/client.js";
import { json, type RecordedCall, stubFetch } from "../support/fetch.js";
import { fail } from "../support/widgets.js";

// Golden fixtures of Backend PR #58 (src/test/resources/contract/http), synthetic data.
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/widgets/${name}.json`, import.meta.url), "utf8"));
const NOW = new Date("2026-10-05T09:00:00+03:00");
const W = "widgets.test";

type Route = unknown | ((call: RecordedCall) => Response);

async function connect(routes: Record<string, Route>, options: { token?: string } = { token: "iwc_test" }) {
  const revoked: string[] = [];
  const fetchFn = stubFetch((call) => {
    const route = routes[`${call.method} ${call.url.host}${call.url.pathname}`];
    if (route === undefined) return json({ error: `no route ${call.method} ${call.url.pathname}` }, 599);
    return typeof route === "function" ? (route as (c: RecordedCall) => Response)(call) : json(route);
  });
  const server = createServer({
    my: createMyItmoClient({ tokens: { accessToken: async () => "t", forceRefresh: async () => "t" }, fetchFn }),
    bars: createBarsClient({ session: { authorization: async () => "Bearer b", invalidate: () => undefined }, fetchFn }),
    widgets: new WidgetsClient("https://widgets.test", async () => options.token, fetchFn, async () => void revoked.push("revoked")),
    isu: async () => 111,
    now: () => NOW,
    actions: new PendingActions(() => NOW.getTime()),
  });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as { text: string }[])[0]!.text;
    return { isError: Boolean(res.isError), text, body: res.isError ? undefined : JSON.parse(text) };
  };
  return { call, calls: fetchFn.calls, revoked };
}

describe("widgets tools", () => {
  it("reads teacher reviews with the connection token", async () => {
    const { call, calls } = await connect({ [`GET ${W}/api/teachers/200001/reviews`]: fixture("teacherReviews") });

    const { body } = await call("widgets_get_teacher_reviews", { teacher_isu: 200001 });

    expect(calls[0]!.headers.get("authorization")).toBe("Bearer iwc_test");
    expect(calls[0]!.headers.get("x-client")).toMatch(/^kind=mcp; /);
    expect(body.reviews[0]).toEqual({
      source: "ITMO.Widgets",
      subject: "Математический анализ",
      text: "Синтетический отзыв под именем.",
      votes: 4,
      date: "2026-10-06",
      verified_student: true,
      author: "Друг Первый",
    });
    expect(body.reviews[0]).not.toHaveProperty("myVote");
  });

  it("reads subject links of the current semester", async () => {
    const { call, calls } = await connect({ [`GET ${W}/api/subjects/501/links`]: fixture("subjectLinks") });

    const { body } = await call("widgets_get_subject_links", { subject_id: 501 });

    expect(calls[0]!.url.searchParams.get("period")).toBe("2026-1");
    expect(body.period).toBe("2026-1");
    expect(body.mine[0]).toMatchObject({ category: "SCORES", url: "https://example.org/links/1", status: "PRIVATE" });
  });

  it("names the scope to turn on when Backend denies the route", async () => {
    const { call } = await connect({ [`GET ${W}/api/subjects/501/links`]: () => fail(403, "access_denied") });

    const result = await call("widgets_get_subject_links", { subject_id: 501, period: "2026-2" });

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/"links:read".*«Ссылки предметов».*Устройства/);
  });

  it("asks to pair when there is no connection", async () => {
    const { call, calls } = await connect({}, {});

    const result = await call("widgets_get_teacher_reviews", { teacher_isu: 1 });

    expect(result.text).toMatch(/itmo-mcp pair/);
    expect(calls).toHaveLength(0);
  });

  it("forgets a revoked connection", async () => {
    const { call, revoked } = await connect({ [`GET ${W}/api/teachers/1/reviews`]: () => fail(401, "unauthorized") });

    const result = await call("widgets_get_teacher_reviews", { teacher_isu: 1 });

    expect(result.text).toMatch(/revoked/);
    expect(revoked).toEqual(["revoked"]);
  });

  it("joins the free queue only after confirmation", async () => {
    const { call, calls } = await connect({
      [`GET ${W}/api/sport/free-sign/entry/my`]: { success: true, data: [], error: null },
      [`GET ${W}/api/sport/auto-sign/entry/my`]: { success: true, data: [], error: null },
      [`POST ${W}/api/sport/free-sign/entry/create`]: fixture("createSportFreeSignEntry"),
    });

    const preview = await call("widgets_sport_queue_join_preview", { queue: "free", lesson_id: 9001 });
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
    const done = await call("itmo_confirm_action", { confirmation_token: preview.body.confirmation_token });

    expect(JSON.parse(calls.at(-1)!.body)).toEqual({ lessonId: 9001, forceSign: false });
    expect(done.body.result).toMatchObject({ queue: "free", status: "WAITING" });
  });

  it("refuses to queue twice and lists active entries with the auto quota", async () => {
    const { call } = await connect({
      [`GET ${W}/api/sport/free-sign/entry/my`]: fixture("mySportFreeSignEntries"),
      [`GET ${W}/api/sport/auto-sign/entry/my`]: fixture("mySportAutoSignEntries"),
      [`GET ${W}/api/sport/auto-sign/limits`]: fixture("sportAutoSignLimits"),
    });

    const twice = await call("widgets_sport_queue_join_preview", { queue: "free", lesson_id: 9001 });
    const queue = await call("widgets_get_sport_queue");

    expect(twice.text).toMatch(/Already in this queue: entry 11/);
    expect(queue.body.active[0]).toMatchObject({ entry_id: 11, queue: "free", position: "2 of 6", lesson: { lesson_id: 9001 } });
    expect(queue.body.auto_quota).toHaveProperty("limit");
  });
});

describe("periodKey", () => {
  it("splits the academic year in Moscow time", () => {
    expect(periodKey(new Date("2026-09-01T00:00:00+03:00"))).toBe("2026-1");
    expect(periodKey(new Date("2027-01-31T23:59:00+03:00"))).toBe("2026-1");
    expect(periodKey(new Date("2027-01-31T21:30:00Z"))).toBe("2026-2");
    expect(periodKey(new Date("2027-08-31T12:00:00+03:00"))).toBe("2026-2");
  });
});
