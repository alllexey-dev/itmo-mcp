import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { data } from "../clients/my-itmo.js";
import { dateRange, isoDate, weekday } from "./dates.js";
import type { ToolDeps } from "./deps.js";
import { READ_ONLY, run } from "./format.js";

export function registerScheduleTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "itmo_get_schedule",
    {
      title: "Class schedule",
      description:
        "Personal ITMO class timetable (lectures, practices, labs, exams, consultations) for a date range. " +
        "Defaults to the next 7 days starting today (Moscow time). Days without classes are omitted.",
      inputSchema: {
        date_from: isoDate.optional(),
        date_to: isoDate.optional().describe("Inclusive end date, YYYY-MM-DD; at most 62 days after date_from"),
      },
      annotations: { title: "Class schedule", ...READ_ONLY },
    },
    ({ date_from, date_to }) =>
      run(async () => {
        const range = dateRange(deps.now(), date_from, date_to, 7, 62);
        const days = await data(
          "getPersonalSchedule",
          deps.my.GET("/api/schedule/schedule/personal", {
            params: { query: { date_start: range.from, date_end: range.to } },
          }),
        );
        return {
          range,
          days: (days ?? [])
            .filter((day) => day.lessons.length > 0)
            .map((day) => ({
              date: day.date,
              weekday: weekday(day.date),
              academic_week: day.week_number,
              note: day.note,
              lessons: day.lessons.map((l) => ({
                time: `${l.time_start}-${l.time_end}`,
                subject: l.subject,
                kind: l.work_type,
                teacher: l.teacher_name,
                teacher_isu: l.teacher_id,
                room: l.room,
                building: l.building,
                format: l.format,
                group: l.group,
                online_url: l.zoom_url,
                online_password: l.zoom_password,
                online_info: l.zoom_info,
                note: l.note,
              })),
            })),
        };
      }),
  );
}
