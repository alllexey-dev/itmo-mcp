import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { AuthError } from "../../src/auth/errors.js";
import { createBarsClient } from "../../src/clients/bars.js";
import { createMyItmoClient } from "../../src/clients/my-itmo.js";
import { createServer } from "../../src/server.js";
import { json, type RecordedCall, stubFetch } from "../support/fetch.js";

const fixture = (path: string) => JSON.parse(readFileSync(new URL(`../fixtures/${path}`, import.meta.url), "utf8"));
const ok = (result: unknown) => ({ error_code: 0, error_message: null, result });

type Routes = Record<string, unknown | ((call: RecordedCall) => Response)>;

async function connect(routes: Routes, options: { isu?: () => Promise<number> } = {}) {
  const fetchFn = stubFetch((call) => {
    const route = routes[`${call.url.host}${call.url.pathname}`];
    if (route === undefined) return json({ error: `no route ${call.url.pathname}` }, 404);
    return typeof route === "function" ? (route as (c: RecordedCall) => Response)(call) : json(route);
  });
  const server = createServer({
    my: createMyItmoClient({
      tokens: { accessToken: async () => "SECRET-ACCESS", forceRefresh: async () => "SECRET-ACCESS-2" },
      fetchFn,
    }),
    bars: createBarsClient({
      session: { authorization: async () => "Bearer SECRET-BARS", invalidate: () => undefined },
      fetchFn,
    }),
    isu: options.isu ?? (async () => 123456),
    now: () => new Date("2026-10-04T22:30:00Z"), // 2026-10-05 01:30 in Moscow
  });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as { type: string; text: string }[])[0]!.text;
    return { isError: Boolean(res.isError), text, body: res.isError ? undefined : JSON.parse(text) };
  };
  return { client, call, calls: fetchFn.calls };
}

const MY = "my.itmo.ru";
const BARS = "bars.itmo.ru/backend/rest";

describe("itmo-mcp server", () => {
  it("exposes only read-only tools with descriptions", async () => {
    const { client } = await connect({});

    const { tools } = await client.listTools();

    expect(tools.length).toBe(19);
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
      expect(tool.annotations?.destructiveHint, tool.name).toBe(false);
      expect(tool.description?.length, tool.name).toBeGreaterThan(20);
    }
  });

  it("itmo_get_schedule defaults to 7 days from today in Moscow and drops empty days", async () => {
    const schedule = fixture("my-itmo/schedule/personal.json");
    schedule.data.push({ day_number: 2, week_number: 6, date: "2026-10-06", lessons: [] });
    const { call, calls } = await connect({ [`${MY}/api/schedule/schedule/personal`]: schedule });

    const { body } = await call("itmo_get_schedule");

    expect(calls[0]!.url.search).toBe("?date_start=2026-10-05&date_end=2026-10-11");
    expect(body.range).toEqual({ from: "2026-10-05", to: "2026-10-11" });
    expect(body.days.map((d: { date: string }) => d.date)).toEqual(["2026-10-05"]);
    expect(body.days[0]).toMatchObject({ weekday: "Monday" });
    expect(body.days[0].lessons[0].time).toMatch(/^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/);
  });

  it("itmo_get_schedule rejects inverted ranges with a readable error", async () => {
    const { call } = await connect({});

    const res = await call("itmo_get_schedule", { date_from: "2026-10-10", date_to: "2026-10-01" });

    expect(res).toMatchObject({ isError: true, text: "date_to (2026-10-01) is before date_from (2026-10-10)" });
  });

  it("itmo_get_grades uses the current semester of the program", async () => {
    const { call, calls } = await connect({
      [`${MY}/api/record_book/specializations`]: ok([
        {
          main_plan: 77,
          specialization_name: "Software engineering",
          semesters: [
            { semester: 1, course: 1, study_year: "2025/2026", actual: false },
            { semester: 2, course: 1, study_year: "2025/2026", actual: true },
          ],
        },
      ]),
      [`${MY}/api/record_book/77/2`]: ok([
        { name: " Math ", est_id: 5, have_tree: true, current_score: 81.5, rate: "4/B", control_type: "Экзамен" },
        { name: "PE", est_id: 6, have_tree: false, current_score: null, rate: null, control_type: "Зачёт" },
      ]),
    });

    const { body } = await call("itmo_get_grades");

    expect(calls.map((c) => c.url.pathname)).toEqual(["/api/record_book/specializations", "/api/record_book/77/2"]);
    expect(body.semester).toBe(2);
    expect(body.disciplines).toEqual([
      { name: "Math", points: 81.5, grade: "4/B", assessment: "Экзамен", entry_id: 5 },
      { name: "PE", assessment: "Зачёт" },
    ]);
  });

  it("itmo_get_study_plan flattens disciplines of the requested semester", async () => {
    const { call } = await connect({
      [`${MY}/api/eduPlanNew/programs`]: ok({ isu: 1, programs: [{ planId: 10, specializationId: 3, name: "SE", isActive: true }] }),
      [`${MY}/api/eduPlanNew/study_plan/10`]: (c: RecordedCall) => {
        expect(c.url.searchParams.get("spec_id")).toBe("3");
        return json(
          ok({
            id: 10,
            currentSemester: 2,
            structure: [
              {
                id: 1,
                name: "Core",
                type: "module",
                children: [
                  {
                    id: 2,
                    name: "Algorithms",
                    type: "discipline",
                    contents: {
                      "2": [{ id: 9, semester: 2, creditPoints: 6, activities: [{ id: 1, contentId: 9, name: "Лекции", volume: 32, workTypeId: 1 }] }],
                    },
                  },
                  { id: 3, name: "Physics", type: "discipline", contents: { "1": [{ id: 8, semester: 1, creditPoints: 3, activities: [] }] } },
                ],
              },
            ],
          }),
        );
      },
    });

    const { body } = await call("itmo_get_study_plan");

    expect(body.semester).toBe(2);
    expect(body.disciplines).toEqual([{ name: "Algorithms", module: "Core", credits: 6, hours: { Лекции: 32 } }]);
  });

  it("itmo_get_sport_schedule filters by section and availability, sorted and limited", async () => {
    const lesson = (id: number, section: string, date: string, available: number, canSignIn = true) => ({
      id,
      date,
      date_end: date,
      section_name: section,
      section_level: 1,
      type_id: 1,
      limit: 20,
      available,
      intersection: false,
      signed: false,
      can_sign_in: { can_sign_in: canSignIn, unavailable_reasons: canSignIn ? [] : { "0": "Нет попыток" } },
    });
    const { call, calls } = await connect({
      [`${MY}/api/sport/sign/schedule`]: ok([
        {
          date: "2026-10-05",
          lessons: [
            lesson(3, "Волейбол", "2026-10-06T10:00:00+03:00", 4),
            lesson(1, "Волейбол", "2026-10-05T10:00:00+03:00", 2),
            lesson(2, "Волейбол", "2026-10-05T12:00:00+03:00", 0),
            lesson(4, "Бассейн", "2026-10-05T09:00:00+03:00", 5),
            lesson(5, "Волейбол", "2026-10-05T15:00:00+03:00", 5, false),
          ],
        },
      ]),
    });

    const { body } = await call("itmo_get_sport_schedule", { section: "волей", sport_type_id: [7], limit: 1 });

    expect(calls[0]!.url.searchParams.getAll("sport_type_id")).toEqual(["7"]);
    expect(body).toMatchObject({ total: 2, truncated: true });
    expect(body.lessons.map((l: { lesson_id: number }) => l.lesson_id)).toEqual([1]);

    const all = await call("itmo_get_sport_schedule", { only_available: false, section: "волей" });
    expect(all.body.lessons.find((l: { lesson_id: number }) => l.lesson_id === 5).why_not).toEqual(["Нет попыток"]);
  });

  it("itmo_get_profile looks up the signed-in user's ISU", async () => {
    const { call, calls } = await connect(
      { [`${MY}/api/personalities/persons/555`]: fixture("my-itmo/personalities/student.json") },
      { isu: async () => 555 },
    );

    const { body } = await call("itmo_get_profile");

    expect(calls[0]!.url.pathname).toBe("/api/personalities/persons/555");
    expect(body.education.length).toBeGreaterThan(0);
  });

  it("bars_get_scores resolves each journal and maps marks to checkpoints", async () => {
    const { call, calls } = await connect({
      [`${BARS}/users/current_user/`]: fixture("bars/user.json"),
      [`${BARS}/journal/disciplines`]: fixture("bars/disciplines.json"),
      [`${BARS}/journal/groups-and-flows`]: [{ type: "flow", name: "F", identifier: "94154", checkpoint_plan_ids: [8] }],
      [`${BARS}/marks/8/flow/94154/student`]: fixture("bars/journal.json"),
    });

    const { body } = await call("bars_get_scores", { discipline: "SYNTHETIC" });

    expect(calls.find((c) => c.url.pathname.endsWith("groups-and-flows"))!.url.search).toBe("?checkpointPlanId=8");
    expect(body.disciplines).toHaveLength(1);
    expect(body.disciplines[0]).toMatchObject({
      discipline: "Synthetic discipline",
      final_grade: "Удвл., E",
      checkpoints: [{ name: "Synthetic work", points: 7.5 }],
    });
  });

  it("bars_get_scores returns nothing for an unmatched filter without loading journals", async () => {
    const { call, calls } = await connect({
      [`${BARS}/users/current_user/`]: fixture("bars/user.json"),
      [`${BARS}/journal/disciplines`]: fixture("bars/disciplines.json"),
    });

    const { body } = await call("bars_get_scores", { discipline: "astronomy" });

    expect(body.disciplines).toBeUndefined();
    expect(calls).toHaveLength(2);
  });

  it("maps API errors to tool errors without leaking credentials", async () => {
    const { call } = await connect({
      [`${MY}/api/requests/my`]: () => json({ error_code: 7, error_message: "Сервис недоступен" }, 503),
    });

    const res = await call("itmo_get_requests");

    expect(res).toEqual({
      isError: true,
      text: "my.itmo.ru getMyRequests failed: HTTP 503, code 7, Сервис недоступен",
      body: undefined,
    });
    expect(res.text).not.toContain("SECRET");
  });

  it("maps authentication failures to tool errors", async () => {
    const { call } = await connect({}, { isu: async () => Promise.reject(new AuthError("No ITMO credentials: set ITMO_USERNAME")) });

    const res = await call("itmo_get_profile");

    expect(res).toMatchObject({ isError: true, text: "No ITMO credentials: set ITMO_USERNAME" });
  });
});
