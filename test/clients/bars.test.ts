import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bars, createBarsClient } from "../../src/clients/bars.js";
import { ItmoApiError } from "../../src/clients/errors.js";
import { type Handler, json, stubFetch } from "../support/fetch.js";

const fixture = (path: string) => JSON.parse(readFileSync(new URL(`../fixtures/bars/${path}`, import.meta.url), "utf8"));

function setup(handler: Handler) {
  const fetchFn = stubFetch(handler);
  let generation = 1;
  const invalidated: string[] = [];
  const session = {
    authorization: async () => `Bearer bars-${generation}`,
    invalidate: (value: string) => {
      invalidated.push(value);
      generation += 1;
    },
  };
  return { fetchFn, invalidated, client: createBarsClient({ session, fetchFn }) };
}

describe("createBarsClient", () => {
  it("sends the session and encodes journal path segments", async () => {
    const { client, fetchFn } = setup(() => json(fixture("journal.json")));

    const journal = await bars(
      "getStudentJournal",
      client.GET("/marks/{checkpointPlanId}/{type}/{identifier}/student", {
        params: { path: { checkpointPlanId: 8, type: "flow", identifier: "a/b c" } },
      }),
    );

    expect(fetchFn.calls[0]!.url.pathname).toBe("/backend/rest/marks/8/flow/a%2Fb%20c/student");
    expect(fetchFn.calls[0]!.headers.get("authorization")).toBe("Bearer bars-1");
    expect(journal.students).toHaveLength(1);
  });

  it("invalidates the rejected session and retries once after a 401", async () => {
    const { client, fetchFn, invalidated } = setup((call) =>
      call.headers.get("authorization") === "Bearer bars-1" ? json({}, 401) : json(fixture("disciplines.json")),
    );

    await bars("getDisciplines", client.GET("/journal/disciplines"));

    expect(invalidated).toEqual(["Bearer bars-1"]);
    expect(fetchFn.calls.map((c) => c.headers.get("authorization"))).toEqual(["Bearer bars-1", "Bearer bars-2"]);
  });

  it("reports Spring errors with status and message", async () => {
    const { client } = setup(() => json({ status: 400, error: "Bad Request", message: "Required checkpointPlanId" }, 400));

    const error = await bars("getGroupsAndFlows", client.GET("/journal/groups-and-flows")).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ItmoApiError);
    expect((error as Error).message).toBe("bars.itmo.ru getGroupsAndFlows failed: HTTP 400, Required checkpointPlanId");
  });
});
