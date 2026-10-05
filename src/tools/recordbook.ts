import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { result } from "../clients/my-itmo.js";
import type { ToolDeps } from "./deps.js";
import { READ_ONLY, run } from "./format.js";

type Teacher = { surname?: string | null; name?: string | null; patronymic?: string | null } | null | undefined;

const teacherName = (t: Teacher) => (t ? [t.surname, t.name, t.patronymic].filter(Boolean).join(" ") : undefined);

export function registerRecordBookTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "itmo_get_grades",
    {
      title: "Record book grades",
      description:
        "Final grades from the ITMO record book (zachetka) for one semester: points, grade, assessment type and date. " +
        "Defaults to the current semester. Use entry_id with itmo_get_grade_details for the points breakdown.",
      inputSchema: {
        semester: z.number().int().min(1).optional().describe("Sequential semester number in the study plan (1, 2, ...)"),
      },
      annotations: { title: "Record book grades", ...READ_ONLY },
    },
    ({ semester }) =>
      run(async () => {
        const specializations = (await result(
          "getRecordBookSpecializations",
          deps.my.GET("/api/record_book/specializations"),
        )) ?? [];
        const program =
          specializations.find((s) => s.semesters.some((x) => x.actual)) ?? specializations[0];
        if (!program) return { message: "No record book is available for this account." };
        const chosen =
          semester ?? program.semesters.find((s) => s.actual)?.semester ?? program.semesters.at(-1)?.semester ?? 1;
        const entries = await result(
          "getRecordBook",
          deps.my.GET("/api/record_book/{specializationId}/{semester}", {
            params: { path: { specializationId: program.main_plan, semester: chosen } },
          }),
        );
        return {
          program: program.specialization_name,
          semester: chosen,
          available_semesters: program.semesters.map((s) => ({
            semester: s.semester,
            course: s.course,
            study_year: s.study_year,
            current: s.actual || undefined,
          })),
          disciplines: (entries ?? []).map((e) => ({
            name: e.name.trim(),
            points: e.current_score,
            grade: e.rate,
            assessment: e.control_type,
            date: e.exam_date,
            attempt: e.attempt || undefined,
            teacher: teacherName(e.teacher),
            entry_id: e.have_tree ? e.est_id : undefined,
            lms: e.lms_link,
          })),
        };
      }),
  );

  server.registerTool(
    "itmo_get_grade_details",
    {
      title: "Grade breakdown",
      description: "Points breakdown (assessments, min/max points, received points) for one record book entry.",
      inputSchema: { entry_id: z.number().int().positive().describe("entry_id from itmo_get_grades") },
      annotations: { title: "Grade breakdown", ...READ_ONLY },
    },
    ({ entry_id }) =>
      run(async () => {
        const entries = await result(
          "getRecordBookControlEntries",
          deps.my.GET("/api/record_book/{entryId}", { params: { path: { entryId: entry_id } } }),
        );
        return (entries ?? []).map((e) => ({
          id: e.id,
          parent_id: e.parent_id,
          name: e.control_name,
          points: e.rate,
          min: e.min_value,
          max: e.max_value,
          required: e.required || undefined,
          date: e.date,
          teacher: teacherName(e.teacher),
        }));
      }),
  );
}
