import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { result } from "../clients/my-itmo.js";
import type { components } from "../generated/my-itmo.js";
import { addDays, dateRange, isoDate, today } from "./dates.js";
import type { ToolDeps } from "./deps.js";
import { READ_ONLY, run } from "./format.js";

type SportLesson = components["schemas"]["SportLesson"];

const reasons = (value: unknown): string[] | undefined => {
  if (Array.isArray(value)) return value.map(String);
  if (value && typeof value === "object") return Object.values(value).map(String);
  return undefined;
};

const lessonView = (l: SportLesson) => ({
  lesson_id: l.id,
  start: l.date,
  end: l.date_end,
  section: l.section_name,
  teacher: l.teacher_fio,
  room: l.room_name,
  free_places: l.available,
  places: l.limit,
  signed: l.signed || undefined,
  can_sign_in: l.can_sign_in?.can_sign_in,
  why_not: reasons(l.can_sign_in?.unavailable_reasons),
  overlaps_classes: l.intersection || undefined,
  comment: l.comment,
});

export function registerSportTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "itmo_get_sport_status",
    {
      title: "Physical education status",
      description:
        "Physical education (sport) summary: points this semester, enrolled sections, upcoming enrolled lessons " +
        "for 14 days, enrollment attempts, debt and medical health group.",
      annotations: { title: "Physical education status", ...READ_ONLY },
    },
    () =>
      run(async () => {
        const from = today(deps.now());
        const [semester, score, chosen, calendar, attempts, debt, health] = await Promise.all([
          result("getCurrentSportSemester", deps.my.GET("/api/sport/semesters/current")),
          result("getSportScore", deps.my.GET("/api/sport/personal/score")),
          result("getSportChosen", deps.my.GET("/api/sport/sign/chosen")),
          result(
            "getSportCalendar",
            deps.my.GET("/api/sport/personal/calendar", {
              params: { query: { date_start: from, date_end: addDays(from, 13) } },
            }),
          ),
          result("getSportAttempts", deps.my.GET("/api/sport/personal/have_attempts")),
          result("getSportDebt", deps.my.GET("/api/sport/personal/debt")),
          result("getSportHealthLevel", deps.my.GET("/api/sport/personal/health_level")),
        ]);
        return {
          semester: semester && { study_year: semester.study_year, start: semester.date_start, end: semester.date_end },
          points: score && {
            attendance: score.sum.attendances,
            other: score.sum.other,
            total: (score.sum.attendances ?? 0) + (score.sum.other ?? 0),
          },
          sections: chosen
            ?.filter((s) => s.lesson_groups?.some((g) => g.weekdays?.length || g.lessons?.length))
            .map((s) => ({
            section: s.section_name,
            groups: s.lesson_groups?.map((g) => ({
              level: g.level_name,
              weekly: g.weekdays?.map((w) => `${w.weekday} ${w.time_start}-${w.time_end} ${w.room_name ?? ""}`.trim()),
            })),
          })),
          upcoming_lessons: calendar?.flatMap((day) => day.lessons ?? []).map(lessonView),
          attempts,
          debt: debt && { has_debt: debt.is_having_debt, points_needed: debt.needed_score, free_attempts: debt.free_attempts },
          health_group: health?.health_level?.name,
        };
      }),
  );

  server.registerTool(
    "itmo_get_sport_points_history",
    {
      title: "Sport points history",
      description: "Every physical education point award (lessons, competitions) for a sports semester.",
      inputSchema: {
        semester_id: z.number().int().optional().describe("Sports semester id from itmo_get_sport_filters; current if omitted"),
      },
      annotations: { title: "Sport points history", ...READ_ONLY },
    },
    ({ semester_id }) =>
      run(async () => {
        const score = await result(
          "getSportScore",
          deps.my.GET("/api/sport/personal/score", { params: { query: semester_id ? { semester_id } : {} } }),
        );
        return {
          points: score?.sum,
          awards: score?.attendances?.map((a) => ({
            date: a.date,
            name: a.name,
            points: a.score,
            evaluation: a.evaluation_name,
            competition: a.competition_name,
            place: a.place,
          })),
        };
      }),
  );

  server.registerTool(
    "itmo_get_sport_schedule",
    {
      title: "Sport lessons available for enrollment",
      description:
        "Physical education lessons open for enrollment with free places and enrollment restrictions. " +
        "Defaults to 7 days from today. Filter ids come from itmo_get_sport_filters. Read-only: does not enroll.",
      inputSchema: {
        date_from: isoDate.optional(),
        date_to: isoDate.optional().describe("Inclusive end date; at most 14 days after date_from"),
        sport_type_id: z.array(z.number().int()).optional().describe("Sport type ids"),
        building_id: z.number().int().optional().describe("Building id; -1 is online"),
        teacher_isu: z.array(z.number().int()).optional(),
        section: z.string().optional().describe("Case-insensitive part of a section name, e.g. волейбол, бассейн"),
        only_available: z.boolean().default(true).describe("Hide lessons without free places or that cannot be joined"),
        limit: z.number().int().min(1).max(200).default(40).describe("Maximum lessons to return, earliest first"),
      },
      annotations: { title: "Sport lessons available for enrollment", ...READ_ONLY },
    },
    ({ date_from, date_to, sport_type_id, building_id, teacher_isu, section, only_available, limit }) =>
      run(async () => {
        const range = dateRange(deps.now(), date_from, date_to, 7, 15);
        const days = await result(
          "getSportSchedule",
          deps.my.GET("/api/sport/sign/schedule", {
            params: {
              query: { date_start: range.from, date_end: range.to, sport_type_id, building_id, teacher_isu },
            },
          }),
        );
        const needle = section?.toLocaleLowerCase();
        const lessons = (days ?? [])
          .flatMap((day) => day.lessons ?? [])
          .filter((l) => !needle || l.section_name?.toLocaleLowerCase().includes(needle))
          .filter((l) => !only_available || l.signed || ((l.available ?? 0) > 0 && l.can_sign_in?.can_sign_in !== false))
          .sort((a, b) => a.date.localeCompare(b.date));
        return {
          range,
          total: lessons.length,
          truncated: lessons.length > limit || undefined,
          lessons: lessons.slice(0, limit).map(lessonView),
        };
      }),
  );

  server.registerTool(
    "itmo_get_sport_filters",
    {
      title: "Sport filters and semesters",
      description: "Ids and names of sport types, buildings and sports semesters (optionally sections and teachers) for other sport tools.",
      inputSchema: {
        include_sections_and_teachers: z.boolean().default(false).describe("Also list all sections and teachers (large)"),
      },
      annotations: { title: "Sport filters and semesters", ...READ_ONLY },
    },
    ({ include_sections_and_teachers }) =>
      run(async () => {
        const [filters, semesters] = await Promise.all([
          result("getSportScheduleFilters", deps.my.GET("/api/sport/sign/schedule/filters")),
          result("getSportSemesters", deps.my.GET("/api/sport/semesters/list")),
        ]);
        return {
          sport_types: filters?.sport_type_id,
          buildings: filters?.building_id,
          sections: include_sections_and_teachers ? filters?.section_id : undefined,
          teachers: include_sections_and_teachers ? filters?.teacher_isu : undefined,
          semesters,
        };
      }),
  );

  server.registerTool(
    "itmo_get_sport_competitions",
    {
      title: "Sport competitions",
      description: "University sports competitions with dates, venue, free places and registration status.",
      inputSchema: { sport_type_id: z.number().int().optional() },
      annotations: { title: "Sport competitions", ...READ_ONLY },
    },
    ({ sport_type_id }) =>
      run(async () => {
        const competitions = await result(
          "getSportCompetitions",
          deps.my.GET("/api/sport/competitions/list", { params: { query: sport_type_id ? { sport_type_id } : {} } }),
        );
        return competitions?.map((c) => ({
          name: c.name,
          kind: c.competition_type_name,
          sport: c.sport_type_name,
          start: c.date_start,
          end: c.date_end,
          venue: c.building_name,
          status: c.competition_status_name,
          free_places: c.available,
          places: c.limit,
          disciplines: c.disciplines?.map((d) => d.name),
          signed: (c.signed ?? 0) > 0 || undefined,
          can_sign_in: c.sign_in_info?.can_sign_in,
          registration_link: c.registration_link,
        }));
      }),
  );
}
