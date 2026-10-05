import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { result } from "../clients/my-itmo.js";
import type { ToolDeps } from "./deps.js";
import { READ_ONLY, run } from "./format.js";

export function registerProfileTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "itmo_get_profile",
    {
      title: "My ITMO profile",
      description: "Profile of the signed-in ITMO student: ISU number, full name, faculty, group, course.",
      annotations: { title: "My ITMO profile", ...READ_ONLY },
    },
    () => run(async () => getPerson(deps, await deps.isu())),
  );

  server.registerTool(
    "itmo_search_people",
    {
      title: "Search ITMO people",
      description:
        "Search ITMO students and employees by name, ISU number or other attributes. Returns ISU numbers, contacts and positions.",
      inputSchema: {
        query: z.string().min(2).describe("Name, surname or ISU number"),
        limit: z.number().int().min(1).max(50).default(10),
        offset: z.number().int().min(0).default(0),
      },
      annotations: { title: "Search ITMO people", ...READ_ONLY },
    },
    ({ query, limit, offset }) =>
      run(async () => {
        const page = await result(
          "searchPersons",
          deps.my.GET("/api/personalities/persons", { params: { query: { q: query, limit, offset } } }),
        );
        return {
          total: page?.count,
          people: page?.data.map((p) => ({ isu: p.id, fio: p.fio, work: p.work, email: p.email, phone: p.phone })),
        };
      }),
  );

  server.registerTool(
    "itmo_get_person",
    {
      title: "ITMO person by ISU",
      description: "Public profile of an ITMO student or employee by ISU number: positions, contacts, education.",
      inputSchema: { isu: z.number().int().positive().describe("ISU number") },
      annotations: { title: "ITMO person by ISU", ...READ_ONLY },
    },
    ({ isu }) => run(() => getPerson(deps, isu)),
  );
}

async function getPerson(deps: ToolDeps, isu: number) {
  const person = await result(
    "getPerson",
    deps.my.GET("/api/personalities/persons/{isu}", { params: { path: { isu } } }),
  );
  if (!person) return undefined;
  return {
    isu: person.isu,
    fio: person.fio,
    education: person.education,
    positions: person.positions?.map((p) => ({ position: p.position_name, department: p.department_name })),
    contacts: person.contacts?.map((c) => ({ type: c.contact_alias, values: c.contact })),
    rooms: person.rooms,
    degree: person.levels,
    exchange_student: person.exchange_training || undefined,
  };
}
