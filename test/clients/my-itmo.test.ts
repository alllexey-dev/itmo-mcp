import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createMyItmoClient, data, result } from "../../src/clients/my-itmo.js";
import { ItmoApiError } from "../../src/clients/errors.js";
import { type Handler, json, stubFetch } from "../support/fetch.js";

const fixture = (path: string) => JSON.parse(readFileSync(new URL(`../fixtures/my-itmo/${path}`, import.meta.url), "utf8"));

function setup(handler: Handler) {
  const fetchFn = stubFetch(handler);
  let generation = 1;
  const tokens = {
    accessToken: async () => `token-${generation}`,
    forceRefresh: async () => `token-${++generation}`,
  };
  return { fetchFn, client: createMyItmoClient({ tokens, fetchFn }) };
}

describe("createMyItmoClient", () => {
  it("sends the bearer token and language, and serializes the date range", async () => {
    const { client, fetchFn } = setup(() => json(fixture("schedule/personal.json")));

    const days = await data(
      "getPersonalSchedule",
      client.GET("/api/schedule/schedule/personal", {
        params: { query: { date_start: "2026-10-05", date_end: "2026-10-11" } },
      }),
    );

    const call = fetchFn.calls[0]!;
    expect(call.url.href).toBe(
      "https://my.itmo.ru/api/schedule/schedule/personal?date_start=2026-10-05&date_end=2026-10-11",
    );
    expect(call.headers.get("authorization")).toBe("Bearer token-1");
    expect(call.headers.get("accept-language")).toBe("ru");
    expect(days?.[0]?.lessons.length).toBeGreaterThan(0);
  });

  it("serializes repeated array filters for the sports schedule", async () => {
    const { client, fetchFn } = setup(() => json(fixture("sport/schedule.json")));

    await result(
      "getSportSchedule",
      client.GET("/api/sport/sign/schedule", {
        params: { query: { date_start: "2026-10-05", date_end: "2026-10-11", sport_type_id: [1, 2] } },
      }),
    );

    expect(fetchFn.calls[0]!.url.search).toBe("?date_start=2026-10-05&date_end=2026-10-11&sport_type_id=1&sport_type_id=2");
  });

  it("refreshes the token once and retries after a 401", async () => {
    const { client, fetchFn } = setup((call) =>
      call.headers.get("authorization") === "Bearer token-1" ? json({}, 401) : json(fixture("requests/my.json")),
    );

    const requests = await result("getMyRequests", client.GET("/api/requests/my"));

    expect(fetchFn.calls.map((c) => c.headers.get("authorization"))).toEqual(["Bearer token-1", "Bearer token-2"]);
    expect(requests?.length).toBeGreaterThan(0);
  });

  it("turns a non-zero error_code into ItmoApiError with the server message", async () => {
    const { client } = setup(() => json({ error_code: 100, error_message: "Персона не найдена", result: null }, 400));

    const error = await result(
      "getPerson",
      client.GET("/api/personalities/persons/{isu}", { params: { path: { isu: 1 } } }),
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ItmoApiError);
    expect(error).toMatchObject({ status: 400, code: 100, serverMessage: "Персона не найдена" });
  });

  it("rejects an error_code inside an HTTP 200 envelope", async () => {
    const { client } = setup(() => json({ error_code: 5, error_message: "nope" }));

    await expect(result("getMyRequests", client.GET("/api/requests/my"))).rejects.toMatchObject({ code: 5 });
  });

  it("rejects a non-zero schedule code", async () => {
    const { client } = setup(() => json({ code: 3, message: "bad range", data: null }));

    await expect(
      data(
        "getPersonalSchedule",
        client.GET("/api/schedule/schedule/personal", { params: { query: { date_start: "a", date_end: "b" } } }),
      ),
    ).rejects.toMatchObject({ code: 3 });
  });

  it("hides HTML gateway pages", async () => {
    const { client } = setup(() => new Response("<html>502 Bad Gateway</html>", { status: 502 }));

    const error = await result("getMyRequests", client.GET("/api/requests/my")).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ItmoApiError);
    expect((error as Error).message).toBe("my.itmo.ru getMyRequests failed: HTTP 502");
  });

  it("accepts a null error_code as success", async () => {
    const { client } = setup(() => json({ error_code: null, error_message: null, result: { count: 0, list: [] } }));

    expect(await result("getMyRoomBookings", client.GET("/api/booking/bookings/my"))).toEqual({ count: 0, list: [] });
  });
});

describe("transient server errors", () => {
  it("retries a GET once after a 5xx", async () => {
    let n = 0;
    const { client, fetchFn } = setup(() => (++n === 1 ? json({}, 500) : json(fixture("requests/my.json"))));

    await result("getMyRequests", client.GET("/api/requests/my"));

    expect(fetchFn.calls).toHaveLength(2);
  });

  it("never repeats a write", async () => {
    const { client, fetchFn } = setup(() => json({ error_code: 1, error_message: "boom" }, 500));

    await expect(
      result("signInSportLessons", client.POST("/api/sport/sign/schedule/lessons", { body: [1] })),
    ).rejects.toMatchObject({ status: 500 });
    expect(fetchFn.calls).toHaveLength(1);
  });
});
