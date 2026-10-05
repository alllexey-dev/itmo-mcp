import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createBarsClient } from "../../src/clients/bars.js";
import { createMyItmoClient } from "../../src/clients/my-itmo.js";
import { createServer } from "../../src/server.js";
import { PendingActions } from "../../src/tools/actions.js";
import { freeIntervals, normalizePhone } from "../../src/tools/booking.js";
import { json, type RecordedCall, stubFetch } from "../support/fetch.js";

const ok = (result: unknown) => ({ error_code: 0, error_message: null, result });
const MY = "my.itmo.ru";
const NOW = new Date("2026-10-05T09:00:00+03:00");

type Route = unknown | ((call: RecordedCall) => Response);

async function connect(routes: Record<string, Route>, writes = true) {
  const fetchFn = stubFetch((call) => {
    const route = routes[`${call.method} ${call.url.host}${call.url.pathname}`] ?? routes[`${call.url.host}${call.url.pathname}`];
    if (route === undefined) return json({ error: `no route ${call.method} ${call.url.pathname}` }, 404);
    return typeof route === "function" ? (route as (c: RecordedCall) => Response)(call) : json(route);
  });
  const deps = {
    my: createMyItmoClient({ tokens: { accessToken: async () => "t", forceRefresh: async () => "t" }, fetchFn }),
    bars: createBarsClient({ session: { authorization: async () => "Bearer b", invalidate: () => undefined }, fetchFn }),
    isu: async () => 111,
    now: () => NOW,
    actions: writes ? new PendingActions(() => NOW.getTime()) : undefined,
  };
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([createServer(deps).connect(serverSide), client.connect(clientSide)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as { text: string }[])[0]!.text;
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
    return { isError: Boolean(res.isError), text, body };
  };
  const writes_ = () => fetchFn.calls.filter((c) => c.method !== "GET" && !c.url.pathname.endsWith("form_update"));
  return { client, call, calls: fetchFn.calls, writes: writes_ };
}

describe("PendingActions", () => {
  it("runs an action once and refuses reuse and expired tokens", async () => {
    let now = 0;
    const actions = new PendingActions(() => now, 1000);
    const a = actions.propose({ action: "a", details: {} }, async () => "done");
    const b = actions.propose({ action: "b", details: {} }, async () => "done");

    expect(await actions.take(a.confirmation_token).execute()).toBe("done");
    expect(() => actions.take(a.confirmation_token)).toThrow(/Unknown or expired/);
    now = 1000;
    expect(() => actions.take(b.confirmation_token)).toThrow(/Unknown or expired/);
  });
});

describe("write tools registration", () => {
  it("are absent unless writes are enabled", async () => {
    const { client } = await connect({}, false);

    const names = (await client.listTools()).tools.map((t) => t.name);

    expect(names.some((n) => n.endsWith("_preview") || n === "itmo_confirm_action")).toBe(false);
  });

  it("previews are read-only and only the confirm tool changes data", async () => {
    const { client } = await connect({});

    const tools = (await client.listTools()).tools;

    expect(tools.filter((t) => t.annotations?.readOnlyHint === false).map((t) => t.name)).toEqual(["itmo_confirm_action"]);
    expect(tools.filter((t) => t.name.endsWith("_preview")).length).toBe(7);
  });
});

const lesson = (overrides: Record<string, unknown> = {}) => ({
  id: 501,
  date: "2026-10-06T10:00:00+03:00",
  date_end: "2026-10-06T11:30:00+03:00",
  section_name: "Волейбол",
  section_level: 1,
  lesson_group_id: 77,
  type_id: 2,
  limit: 20,
  available: 3,
  intersection: false,
  signed: false,
  can_sign_in: { can_sign_in: true, unavailable_reasons: [] },
  ...overrides,
});

const sportRoutes = (l: unknown, attempts = 5) => ({
  [`${MY}/api/sport/sign/schedule`]: ok([{ date: "2026-10-06", lessons: [l] }]),
  [`${MY}/api/sport/personal/calendar`]: ok([{ date: "2026-10-06", lessons: [l] }]),
  [`${MY}/api/sport/personal/have_attempts`]: ok({ total_attempts: 30, used_attempts: 1, free_attempts: attempts, can_sign_in: true }),
  [`POST ${MY}/api/sport/sign/schedule/lessons`]: ok([501]),
  [`DELETE ${MY}/api/sport/sign/schedule/lessons`]: ok([501]),
  [`POST ${MY}/api/sport/sign/schedule/lesson_groups/77`]: ok(null),
  [`DELETE ${MY}/api/sport/sign/schedule/lesson_groups/77`]: ok(null),
});

describe("sport actions", () => {
  it("previews without writing, then enrolls a single lesson on confirm", async () => {
    const { call, writes } = await connect(sportRoutes(lesson()));

    const preview = await call("itmo_sport_signup_preview", { lesson_id: 501, date: "2026-10-06" });

    expect(preview.isError).toBe(false);
    expect(preview.body.warnings.join(" ")).toMatch(/5 remaining attempts/);
    expect(writes()).toHaveLength(0);

    const done = await call("itmo_confirm_action", { confirmation_token: preview.body.confirmation_token });

    expect(done.body).toEqual({ done: expect.stringMatching(/Волейбол/), result: { enrolled_lesson_ids: [501] } });
    expect(writes().map((c) => `${c.method} ${c.url.pathname} ${c.body}`)).toEqual(["POST /api/sport/sign/schedule/lessons [501]"]);
    expect((await call("itmo_confirm_action", { confirmation_token: preview.body.confirmation_token })).isError).toBe(true);
  });

  it("refuses without attempts, without places and for open classes", async () => {
    expect((await (await connect(sportRoutes(lesson(), 0))).call("itmo_sport_signup_preview", { lesson_id: 501, date: "2026-10-06" })).text).toMatch(/No enrollment attempts/);
    expect((await (await connect(sportRoutes(lesson({ available: 0 })))).call("itmo_sport_signup_preview", { lesson_id: 501, date: "2026-10-06" })).text).toMatch(/No free places/);
    expect(
      (await (await connect(sportRoutes(lesson({ section_level: 2, type_id: 1 })))).call("itmo_sport_signup_preview", { lesson_id: 501, date: "2026-10-06" })).text,
    ).toMatch(/questionnaire/);
    expect(
      (await (await connect(sportRoutes(lesson({ can_sign_in: { can_sign_in: false, unavailable_reasons: { "0": "Не пройден отбор" } } })))).call("itmo_sport_signup_preview", { lesson_id: 501, date: "2026-10-06" })).text,
    ).toBe("Enrollment is not allowed: Не пройден отбор");
  });

  it("joins and leaves semester groups through lesson_groups", async () => {
    const { call, writes } = await connect(sportRoutes(lesson({ section_level: 2, signed: false })));
    const join = await call("itmo_sport_signup_preview", { lesson_id: 501, date: "2026-10-06" });
    await call("itmo_confirm_action", { confirmation_token: join.body.confirmation_token });
    const leave = await call("itmo_sport_cancel_preview", { lesson_id: 501, date: "2026-10-06" });
    await call("itmo_confirm_action", { confirmation_token: leave.body.confirmation_token });

    expect(leave.body.warnings[0]).toMatch(/whole semester|every lesson/);
    expect(writes().map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      "POST /api/sport/sign/schedule/lesson_groups/77",
      "DELETE /api/sport/sign/schedule/lesson_groups/77",
    ]);
  });

  it("refuses lessons that have started", async () => {
    const { call } = await connect(sportRoutes(lesson({ date: "2026-10-05T08:00:00+03:00" })));

    expect((await call("itmo_sport_signup_preview", { lesson_id: 501, date: "2026-10-05" })).text).toMatch(/already started/);
  });
});

describe("booking", () => {
  it("computes free intervals inside the booking day", () => {
    expect(freeIntervals([{ start: 600, end: 660 }, { start: 640, end: 720 }, { start: 1350, end: 1440 }]).map((i) => [i.start, i.end])).toEqual([
      [480, 600],
      [720, 1350],
    ]);
  });

  it("normalizes phones", () => {
    expect(normalizePhone("8 921 123-45-67")).toBe("+7 (921) 123-45-67");
    expect(normalizePhone("+7 (921) 1234567")).toBe("+7 (921) 123-45-67");
    expect(normalizePhone("12345")).toBeUndefined();
  });

  const bookingRoutes = {
    [`${MY}/api/booking/rooms/roomsInCategory`]: ok([
      { room_id: 9, room_name: "Переговорная", room_number: "1301", min_cap: 1, max_cap: 6, group: { group_id: 4, group_name: "Коворкинги" } },
    ]),
    [`${MY}/api/booking/dictionary/rooms/categories`]: ok([{ category_id: 603, category_name: "Коворкинг", min_days: 0, max_days: 7 }]),
    [`${MY}/api/booking/rooms/roomBookings`]: ok([
      {
        room_id: 9,
        bookings: [
          { booking_id: 1, booking_name: "x", start_datetime: "2026-10-06T12:00:00+03:00", end_datetime: "2026-10-06T13:00:00+03:00", owner_isu: 222, owner_fio: "Чужой Человек", status: { status_id: 1 } },
          { booking_id: 2, booking_name: "y", start_datetime: "2026-10-06T15:00:00+03:00", end_datetime: "2026-10-06T16:00:00+03:00", owner_isu: 111, owner_fio: "Я", status: { status_id: 2 } },
        ],
      },
    ]),
    [`${MY}/api/booking/users/status`]: ok({ phone_number: "+7 (900) 000-00-00" }),
    [`POST ${MY}/api/booking/bookings/`]: { error_code: null, error_message: null, result: null },
    [`${MY}/api/booking/bookings/my`]: ok({
      count: 1,
      list: [
        { booking_id: 50, start_datetime: "2026-10-06T10:00:00+03:00", end_datetime: "2026-10-06T11:00:00+03:00", owner_isu: 111, room: { room_id: 9 }, status: { status_id: 2, status_name: "Отправлена" } },
      ],
    }),
    [`DELETE ${MY}/api/booking/bookings/50`]: ok(null),
  };

  it("shows availability without other people's names", async () => {
    const { call, calls } = await connect(bookingRoutes);

    const res = await call("itmo_booking_availability", { category_id: 603, date: "2026-10-06" });

    expect(calls.find((c) => c.url.pathname.endsWith("roomBookings"))!.url.search).toBe("?categoryId=603&date=2026-10-06&status=1&status=2&status=5&status=6&status=8");
    expect(res.body).toEqual([
      { room_id: 9, name: "Переговорная", number: "1301", capacity: "1-6", free: ["08:00-12:00", "13:00-15:00", "16:00-23:00"], my_bookings: ["15:00-16:00"] },
    ]);
    expect(res.text).not.toContain("Чужой");
    expect(res.text).not.toContain("222");
  });

  it("refuses overlapping bookings and books exactly one item on confirm", async () => {
    const { call, writes } = await connect(bookingRoutes);
    const base = { room_id: 9, category_id: 603, date: "2026-10-06", title: "Созвон", participants: 3 };

    expect((await call("itmo_booking_create_preview", { ...base, start: "12:30", end: "13:30" })).text).toMatch(/busy 12:00-13:00/);
    expect((await call("itmo_booking_create_preview", { ...base, start: "10:00", end: "10:15" })).text).toMatch(/at least 30 minutes/);
    expect((await call("itmo_booking_create_preview", { ...base, participants: 9, start: "10:00", end: "11:00" })).text).toMatch(/at most 6/);

    const preview = await call("itmo_booking_create_preview", { ...base, start: "10:00", end: "11:00" });
    const done = await call("itmo_confirm_action", { confirmation_token: preview.body.confirmation_token });

    expect(done.body.result).toEqual({ booking_id: 50, status: "Отправлена" });
    expect(JSON.parse(writes()[0]!.body)).toEqual([
      {
        name: "Созвон",
        additional_info: "",
        participants: 3,
        contact_phone: "+7 (900) 000-00-00",
        event_id: null,
        co_bookers: [],
        start_datetime: "2026-10-06 10:00",
        end_datetime: "2026-10-06 11:00",
        room_id: 9,
        equipment: [],
        tech_support: false,
      },
    ]);
  });

  it("cancels only the owner's future bookings", async () => {
    const { call, writes } = await connect(bookingRoutes);

    const preview = await call("itmo_booking_cancel_preview", { booking_id: 50 });
    await call("itmo_confirm_action", { confirmation_token: preview.body.confirmation_token });

    expect(writes().map((c) => `${c.method} ${c.url.pathname}`)).toEqual(["DELETE /api/booking/bookings/50"]);
    expect((await call("itmo_booking_cancel_preview", { booking_id: 51 })).text).toMatch(/not among/);
  });
});

describe("requests", () => {
  const template = {
    template_name: "Справка с места учебы",
    user_can_apply_now: true,
    fields_data: [
      { field_id: 1, field_name: "Группа", field_type: "dictionary", required_field_flag: true, show_condition_flag: true, dictionary_id: 10, init_dictionary: { id: "555", text: "P3213" }, default_value: "555" },
      { field_id: 2, field_name: "Язык печати справки", field_type: "dictionary", required_field_flag: true, show_condition_flag: true, dictionary_id: 20 },
      { field_id: 3, field_name: "Дата", field_type: "date", required_field_flag: false, show_condition_flag: false },
      { field_id: 4, field_name: "Программа", field_type: "dictionary", required_field_flag: true, show_condition_flag: true, dictionary_id: 30 },
    ],
  };
  const routes = (overrides: Record<string, Route> = {}) => ({
    [`${MY}/api/requests/all`]: ok([
      { id: 61, name: "Заказ документов", requests: [{ id: 2706, name: "Справка с места учебы", category_id: 61 }] },
      { id: 125, name: "Отчисление", requests: [{ id: 2626, name: "Заявление по собственному желанию", category_id: 125 }] },
    ]),
    [`${MY}/api/requests/2706`]: ok(template),
    [`${MY}/api/requests/2626`]: ok({ ...template, template_name: "Заявление по собственному желанию" }),
    [`${MY}/api/requests/dict/10`]: ok([{ id: "555", text: "P3213" }]),
    [`${MY}/api/requests/dict/20`]: ok([{ id: "1", text: "Русский" }, { id: "2", text: "Английский" }]),
    [`${MY}/api/requests/dict/30`]: ok([{ id: "77", text: "09.03.04 Программная инженерия" }]),
    [`POST ${MY}/api/requests/form_update`]: (c: RecordedCall) => {
      const body = JSON.parse(c.body);
      const english = body.current_values.find((v: { field_id: string }) => v.field_id === "2")?.value === "2";
      return json(ok(body.changed_field === 2 && english ? { show: ["3"], hide: [] } : { show: [], hide: [] }));
    },
    [`POST ${MY}/api/requests/send`]: ok({ reqId: 9001 }),
    ...overrides,
  });

  it("fills defaults, resolves option text, auto-fills single options and submits on confirm", async () => {
    const { call, calls, writes } = await connect(routes());

    const preview = await call("itmo_request_submit_preview", { template_id: 2706, values: { "язык печати справки": "английский", "Дата": "2026-10-10" } });

    expect(preview.body.details.fields).toEqual({
      Группа: "P3213",
      "Язык печати справки": "Английский",
      Дата: "10.10.2026",
      Программа: "09.03.04 Программная инженерия",
    });
    const formUpdate = JSON.parse(calls.find((c) => c.url.pathname.endsWith("form_update"))!.body);
    expect(formUpdate).toEqual({
      changed_field: 2,
      current_values: [
        { field_id: "1", value: "555" },
        { field_id: "2", value: "2" },
        { field_id: "3", field_type: "date", value: "" },
        { field_id: "4", value: "" },
      ],
    });
    expect(writes()).toHaveLength(0);

    const done = await call("itmo_confirm_action", { confirmation_token: preview.body.confirmation_token });

    expect(done.body.result).toEqual({ request_id: 9001 });
    expect(JSON.parse(writes()[0]!.body)).toEqual({
      request_id: 2706,
      values: [
        { field_id: "1", field_type: "dictionary", value: "555" },
        { field_id: "2", field_type: "dictionary", value: "2" },
        { field_id: "3", field_type: "date", value: "10.10.2026" },
        { field_id: "4", field_type: "dictionary", value: "77" },
      ],
    });
  });

  it("refuses status-changing templates, unknown options and missing fields", async () => {
    const { call } = await connect(routes({ [`${MY}/api/requests/dict/30`]: ok([{ id: "77", text: "A" }, { id: "78", text: "B" }]) }));

    expect((await call("itmo_request_submit_preview", { template_id: 2626, values: {} })).text).toMatch(/changes the student's status/);
    expect((await call("itmo_request_submit_preview", { template_id: 2706, values: { "Язык печати справки": "Китайский" } })).text).toMatch(/not an option.*Русский; Английский/);
    expect((await call("itmo_request_submit_preview", { template_id: 2706, values: { "Язык печати справки": "Русский" } })).text).toBe(
      "Fill the required fields: Программа (4)",
    );
  });

  it("does not send values of fields that stay hidden", async () => {
    const { call, writes } = await connect(routes());

    const preview = await call("itmo_request_submit_preview", { template_id: 2706, values: { "Язык печати справки": "Русский", "Дата": "2026-10-10" } });
    await call("itmo_confirm_action", { confirmation_token: preview.body.confirmation_token });

    expect(preview.body.warnings).toContain('"Дата" is hidden for the chosen options and was not filled.');
    expect(JSON.parse(writes()[0]!.body).values.map((v: { field_id: string }) => v.field_id)).toEqual(["1", "2", "4"]);
  });

  it("maps server validation errors to field names", async () => {
    const { call } = await connect(
      routes({ [`POST ${MY}/api/requests/send`]: () => json({ error_code: 3, error_message: "bad", result: { error_list: [{ field_id: 2, error_text: "Не заполнено" }] } }, 400) }),
    );

    const preview = await call("itmo_request_submit_preview", { template_id: 2706, values: { "Язык печати справки": "Русский" } });
    const done = await call("itmo_confirm_action", { confirmation_token: preview.body.confirmation_token });

    expect(done).toMatchObject({ isError: true, text: "The office form rejected the values: Язык печати справки: Не заполнено" });
  });
});
