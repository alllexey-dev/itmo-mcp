import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { result } from "../clients/my-itmo.js";
import type { components } from "../generated/my-itmo.js";
import type { PendingActions } from "./actions.js";
import { isoDate } from "./dates.js";
import type { ToolDeps } from "./deps.js";
import { PREVIEW, run, ToolRefusal } from "./format.js";
import { reasons } from "./sport.js";

type SportLesson = components["schemas"]["SportLesson"];

const OPEN_CLASS = 1;
const DEBT_LESSON = 5;

const lessonInput = {
  lesson_id: z.number().int().positive().describe("lesson_id from itmo_get_sport_schedule or itmo_get_sport_status"),
  date: isoDate.describe("Date of the lesson, YYYY-MM-DD"),
};

export function registerSportActionTools(server: McpServer, deps: ToolDeps, actions: PendingActions): void {
  server.registerTool(
    "itmo_sport_signup_preview",
    {
      title: "Preview: enroll in a sport lesson",
      description:
        "Checks whether the student can enroll in a physical education lesson (free places, attempts, restrictions) " +
        "and prepares the enrollment. Single lessons use one attempt; semester groups enroll for the whole semester. " +
        "Nothing changes until itmo_confirm_action.",
      inputSchema: lessonInput,
      annotations: { title: "Preview: enroll in a sport lesson", ...PREVIEW },
    },
    ({ lesson_id, date }) =>
      run(async () => {
        const lesson = await findLesson(deps, lesson_id, date, "schedule");
        if (lesson.signed) throw new ToolRefusal("The student is already enrolled in this lesson");
        if (new Date(lesson.date) <= deps.now()) throw new ToolRefusal("The lesson has already started");
        if (lesson.can_sign_in?.can_sign_in === false) {
          throw new ToolRefusal(`Enrollment is not allowed: ${(reasons(lesson.can_sign_in.unavailable_reasons) ?? []).join("; ")}`);
        }
        if ((lesson.available ?? 0) <= 0) throw new ToolRefusal("No free places left in this lesson");

        const warnings: string[] = [];
        if (lesson.intersection) warnings.push("The lesson overlaps the student's class schedule.");
        const details = describe(lesson);

        if (lesson.section_level === 1) {
          const attempts = await freeAttempts(deps, lesson);
          if (attempts <= 0) throw new ToolRefusal("No enrollment attempts left for this kind of lesson");
          warnings.push(
            `Uses one of ${attempts} remaining attempts. A missed lesson still uses the attempt: withdraw before it starts.`,
          );
          return actions.propose({ action: `Enroll in the lesson ${lesson.section_name} at ${lesson.date}`, details, warnings }, async () => {
            const enrolled = await result(
              "signInSportLessons",
              deps.my.POST("/api/sport/sign/schedule/lessons", { body: [lesson.id] }),
            );
            return { enrolled_lesson_ids: enrolled };
          });
        }

        if (lesson.type_id === OPEN_CLASS) {
          throw new ToolRefusal("Open classes of selection-based sections need a questionnaire: enroll on my.itmo.ru");
        }
        const groupId = lesson.lesson_group_id;
        if (!groupId) throw new ToolRefusal("The lesson has no lesson group to join");
        warnings.push("Joins the whole semester group of this section, not a single lesson.");
        return actions.propose({ action: `Join the semester group of ${lesson.section_name}`, details, warnings }, async () => {
          await result(
            "signInSportLessonGroup",
            deps.my.POST("/api/sport/sign/schedule/lesson_groups/{lessonGroupId}", {
              params: { path: { lessonGroupId: groupId } },
            }),
          );
          return { joined_lesson_group_id: groupId };
        });
      }),
  );

  server.registerTool(
    "itmo_sport_cancel_preview",
    {
      title: "Preview: withdraw from a sport lesson",
      description:
        "Prepares withdrawal from an enrolled physical education lesson (single lesson) or from a whole semester group. " +
        "Nothing changes until itmo_confirm_action.",
      inputSchema: lessonInput,
      annotations: { title: "Preview: withdraw from a sport lesson", ...PREVIEW },
    },
    ({ lesson_id, date }) =>
      run(async () => {
        const lesson = await findLesson(deps, lesson_id, date, "calendar");
        if (new Date(lesson.date) <= deps.now()) throw new ToolRefusal("The lesson has already started");
        const details = describe(lesson);

        if (lesson.section_level === 1) {
          return actions.propose(
            {
              action: `Withdraw from the lesson ${lesson.section_name} at ${lesson.date}`,
              details,
              warnings: ["The attempt is returned only when withdrawing before the lesson starts."],
            },
            async () => {
              const withdrawn = await result(
                "signOutSportLessons",
                deps.my.DELETE("/api/sport/sign/schedule/lessons", { body: [lesson.id] }),
              );
              return { withdrawn_lesson_ids: withdrawn };
            },
          );
        }

        const groupId = lesson.lesson_group_id;
        if (!groupId) throw new ToolRefusal("The lesson has no lesson group");
        return actions.propose(
          {
            action: `Leave the whole semester group of ${lesson.section_name}`,
            details,
            warnings: ["Leaves every lesson of this group for the semester; the place may be taken by someone else."],
          },
          async () => {
            await result(
              "signOutSportLessonGroup",
              deps.my.DELETE("/api/sport/sign/schedule/lesson_groups/{lessonGroupId}", {
                params: { path: { lessonGroupId: groupId } },
              }),
            );
            return { left_lesson_group_id: groupId };
          },
        );
      }),
  );

  server.registerTool(
    "itmo_sport_competition_preview",
    {
      title: "Preview: register for a sport competition",
      description:
        "Prepares registration for a university sports competition, or withdrawal when unregister is true. " +
        "discipline_ids replace the current selection. Nothing changes until itmo_confirm_action.",
      inputSchema: {
        competition_id: z.number().int().positive().describe("Competition id from itmo_get_sport_competitions"),
        discipline_ids: z.array(z.number().int()).optional().describe("Disciplines to compete in; required when there are several"),
        unregister: z.boolean().default(false),
      },
      annotations: { title: "Preview: register for a sport competition", ...PREVIEW },
    },
    ({ competition_id, discipline_ids, unregister }) =>
      run(async () => {
        const competitions = await result("getSportCompetitions", deps.my.GET("/api/sport/competitions/list"));
        const competition = competitions?.find((c) => c.id === competition_id);
        if (!competition) throw new ToolRefusal(`Competition ${competition_id} is not in the current list`);
        const disciplines = competition.disciplines ?? [];
        const signed = disciplines.filter((d) => (d.signed ?? 0) > 0).map((d) => d.id);
        const details = { competition: competition.name, start: competition.date_start, venue: competition.building_name };

        if (unregister) {
          if ((competition.signed ?? 0) <= 0 && signed.length === 0) throw new ToolRefusal("The student is not registered");
          return actions.propose({ action: `Withdraw from the competition ${competition.name}`, details }, async () => {
            await result(
              "signOutSportCompetition",
              deps.my.DELETE("/api/sport/sign/competitions/{competitionId}", {
                params: { path: { competitionId: competition_id } },
              }),
            );
            return { withdrawn_competition_id: competition_id };
          });
        }

        if (competition.sign_in_info?.can_sign_in === false) {
          const why = reasons(competition.sign_in_info.unavailable_reasons) ?? [];
          throw new ToolRefusal(`Registration is not allowed${why.length ? `: ${why.join("; ")}` : ""}`);
        }
        const chosen = discipline_ids ?? (disciplines.length === 1 ? [disciplines[0]!.id] : undefined);
        if (!chosen?.length) {
          throw new ToolRefusal(
            `Choose discipline_ids: ${disciplines.map((d) => `${d.id} ${d.name}`).join(", ")}`,
          );
        }
        const unknown = chosen.filter((id) => !disciplines.some((d) => d.id === id));
        if (unknown.length) throw new ToolRefusal(`Unknown discipline ids: ${unknown.join(", ")}`);
        const limits = await result("getSportCompetitionLimits", deps.my.GET("/api/sport/competitions/list/limits"));
        const full = chosen.filter((id) => !signed.includes(id) && (limits?.[String(id)]?.available ?? 1) <= 0);
        if (full.length) throw new ToolRefusal(`No free places in disciplines: ${full.join(", ")}`);

        const name = (id: number) => disciplines.find((d) => d.id === id)?.name ?? String(id);
        return actions.propose(
          {
            action: `Register for the competition ${competition.name}`,
            details: { ...details, disciplines: chosen.map(name) },
            warnings: signed.some((id) => !chosen.includes(id))
              ? [`Also withdraws from: ${signed.filter((id) => !chosen.includes(id)).map(name).join(", ")}`]
              : undefined,
          },
          async () => {
            await result(
              "signInSportCompetition",
              deps.my.POST("/api/sport/sign/competitions/{competitionId}", {
                params: { path: { competitionId: competition_id } },
                body: chosen,
              }),
            );
            return { registered_competition_id: competition_id, disciplines: chosen.map(name) };
          },
        );
      }),
  );
}

async function findLesson(deps: ToolDeps, lessonId: number, date: string, source: "schedule" | "calendar"): Promise<SportLesson> {
  const query = { query: { date_start: date, date_end: date } };
  const days =
    source === "schedule"
      ? await result("getSportSchedule", deps.my.GET("/api/sport/sign/schedule", { params: query }))
      : await result("getSportCalendar", deps.my.GET("/api/sport/personal/calendar", { params: query }));
  const lesson = days?.flatMap((d) => d.lessons ?? []).find((l) => l.id === lessonId);
  if (!lesson) {
    throw new ToolRefusal(
      source === "schedule"
        ? `Lesson ${lessonId} is not in the enrollment schedule on ${date}`
        : `Lesson ${lessonId} is not among the student's enrolled lessons on ${date}`,
    );
  }
  return lesson;
}

async function freeAttempts(deps: ToolDeps, lesson: SportLesson): Promise<number> {
  if (lesson.type_id === DEBT_LESSON) {
    const debt = await result("getSportDebt", deps.my.GET("/api/sport/personal/debt"));
    return debt?.free_attempts ?? 0;
  }
  const attempts = await result("getSportAttempts", deps.my.GET("/api/sport/personal/have_attempts"));
  return attempts?.can_sign_in === false ? 0 : (attempts?.free_attempts ?? 0);
}

function describe(lesson: SportLesson) {
  return {
    lesson_id: lesson.id,
    section: lesson.section_name,
    start: lesson.date,
    end: lesson.date_end,
    teacher: lesson.teacher_fio,
    room: lesson.room_name,
    free_places: lesson.available,
  };
}
