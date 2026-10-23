import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NotPairedError, WidgetsApiError } from "../widgets/client.js";
import type { PendingActions } from "./actions.js";
import type { ToolDeps } from "./deps.js";
import { PREVIEW, READ_ONLY, run, ToolRefusal } from "./format.js";

/** Scopes of an `mcp` connection with the titles the app shows on its switches (Backend `scopes_ru.properties`). */
const SCOPES = {
  "reviews:read": "Отзывы о преподавателях",
  "links:read": "Ссылки предметов",
  "sport:queue": "Очереди на физкультуру",
} as const;

type Scope = keyof typeof SCOPES;

interface SportLesson {
  id: number;
  sectionName: string;
  start: string;
  end: string;
  roomName?: string | null;
  teacherFio?: string | null;
}

interface QueueEntry {
  id: number;
  type: "free" | "auto";
  status: string;
  position: number;
  total: number;
  isCancelled: boolean;
  lessonId?: number;
  prototypeLessonId?: number;
  forceSign?: boolean;
  targetLesson?: SportLesson | null;
  realLesson?: SportLesson | null;
}

interface AutoSignLimits {
  limit: number;
  available: number;
  nextAvailableAt: string;
}

const ACTIVE = new Set(["WAITING", "NOTIFIED"]);

/** Calls ITMO.Widgets for a tool that needs `scope`, turning Backend refusals into instructions for the user. */
async function widgets<T>(scope: Scope, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof NotPairedError) throw new ToolRefusal(error.message);
    if (!(error instanceof WidgetsApiError)) throw error;
    switch (error.code) {
      case "access_denied":
        throw new ToolRefusal(
          `This ITMO.Widgets connection has no "${scope}" access. Ask the user to turn on «${SCOPES[scope]}» in the ` +
            "ITMO.Widgets app: Профиль -> Устройства -> this MCP server.",
        );
      case "unauthorized":
        throw new ToolRefusal(
          "The ITMO.Widgets connection was revoked; this server ended its ITMO session. Run `itmo-mcp pair` to connect again.",
        );
      case "permission_denied":
        throw new ToolRefusal("MCP servers are turned off in ITMO.Widgets right now; try again later.");
      case "rate_limited":
        throw new ToolRefusal("Too many ITMO.Widgets requests: wait at least 10 seconds.");
      default:
        throw new ToolRefusal(error.message);
    }
  }
}

/** The link period `YYYY-S` for a Moscow date: S is 1 for September-January, 2 for February-August. */
export function periodKey(now: Date): string {
  const [year, month] = now
    .toLocaleDateString("en-CA", { timeZone: "Europe/Moscow" })
    .split("-")
    .map(Number) as [number, number];
  if (month >= 9) return `${year}-1`;
  return month === 1 ? `${year - 1}-1` : `${year - 1}-2`;
}

const lessonView = (lesson?: SportLesson | null) =>
  lesson && {
    lesson_id: lesson.id,
    section: lesson.sectionName,
    start: lesson.start,
    end: lesson.end,
    room: lesson.roomName,
    teacher: lesson.teacherFio,
  };

const entryView = (entry: QueueEntry) => ({
  entry_id: entry.id,
  queue: entry.type,
  status: entry.status,
  position: `${entry.position} of ${entry.total}`,
  force: entry.forceSign || undefined,
  lesson: lessonView(entry.realLesson ?? entry.targetLesson),
});

async function myEntries(deps: ToolDeps): Promise<QueueEntry[]> {
  const [free, auto] = await Promise.all([
    deps.widgets.get<QueueEntry[]>("mySportFreeSignEntries", "/api/sport/free-sign/entry/my"),
    deps.widgets.get<QueueEntry[]>("mySportAutoSignEntries", "/api/sport/auto-sign/entry/my"),
  ]);
  return [...free, ...auto];
}

export function registerWidgetsTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "widgets_get_teacher_reviews",
    {
      title: "Teacher reviews (ITMO.Widgets)",
      description:
        "Reviews of an ITMO teacher from ITMO.Widgets users and the Reviews project, with an AI summary when there " +
        "are enough of them. teacher_isu comes from itmo_get_schedule or itmo_search_people. Needs the ITMO.Widgets " +
        "connection (`itmo-mcp pair`) with reviews:read.",
      inputSchema: { teacher_isu: z.number().int().positive().describe("ISU number of the teacher") },
      annotations: { title: "Teacher reviews (ITMO.Widgets)", ...READ_ONLY },
    },
    ({ teacher_isu }) =>
      run(async () => {
        const data = await widgets("reviews:read", () =>
          deps.widgets.get<{
            summary?: Record<string, unknown> | null;
            reviews: {
              kind: string;
              subjectTitle?: string | null;
              text: string;
              score: number;
              verified: boolean;
              writtenOn?: string | null;
              writtenBeforeYear?: number | null;
              author?: { name: string } | null;
              sourceLink?: string | null;
            }[];
          }>("teacherReviews", `/api/teachers/${teacher_isu}/reviews`),
        );
        const summary = data.summary;
        return {
          teacher_isu,
          summary: summary && {
            review_count: summary.reviewCount,
            description: summary.description,
            pros: summary.pros,
            cons: summary.cons,
            tags: summary.tags,
            tone: summary.level,
            confidence: summary.confidence,
            scales: summary.scales,
          },
          reviews: data.reviews.map((review) => ({
            source: review.kind === "REVIEWS" ? "Reviews project" : "ITMO.Widgets",
            subject: review.subjectTitle,
            text: review.text,
            votes: review.score,
            date: review.writtenOn ?? (review.writtenBeforeYear ? `before ${review.writtenBeforeYear}` : undefined),
            verified_student: review.verified || undefined,
            author: review.author?.name,
            link: review.sourceLink,
          })),
        };
      }),
  );

  server.registerTool(
    "widgets_get_subject_links",
    {
      title: "Subject links (ITMO.Widgets)",
      description:
        "Links and chats of a subject shared by classmates in ITMO.Widgets (scores tables, queues, materials, " +
        "recordings, chats) and the student's own ones. subject_id comes from itmo_get_schedule. Needs the " +
        "ITMO.Widgets connection (`itmo-mcp pair`) with links:read.",
      inputSchema: {
        subject_id: z.number().int().positive().describe("subject_id of a lesson from itmo_get_schedule"),
        period: z
          .string()
          .regex(/^\d{4}-[12]$/)
          .optional()
          .describe("Semester YYYY-S: S is 1 for autumn (Sep-Jan), 2 for spring; default the current one"),
      },
      annotations: { title: "Subject links (ITMO.Widgets)", ...READ_ONLY },
    },
    ({ subject_id, period }) =>
      run(async () => {
        const semester = period ?? periodKey(deps.now());
        const data = await widgets("links:read", () =>
          deps.widgets.get<{
            mine: Link[];
            shared: Link[];
            previous: Link[];
          }>("subjectLinks", `/api/subjects/${subject_id}/links`, { period: semester }),
        );
        return {
          subject_id,
          period: semester,
          shared: data.shared.map(linkView),
          mine: data.mine.map(linkView),
          previous_semesters: data.previous.map(linkView),
        };
      }),
  );

  server.registerTool(
    "widgets_get_sport_queue",
    {
      title: "Sport queues (ITMO.Widgets)",
      description:
        "The student's ITMO.Widgets sport queues: waiting for a free place in a full lesson (free) and forecast " +
        "entries for the same lesson two weeks ahead (auto), with positions and the auto quota. The phone books " +
        "the place when it frees up. Needs the ITMO.Widgets connection (`itmo-mcp pair`) with sport:queue.",
      inputSchema: {},
      annotations: { title: "Sport queues (ITMO.Widgets)", ...READ_ONLY },
    },
    () =>
      run(async () => {
        const [entries, limits] = await widgets("sport:queue", () =>
          Promise.all([
            myEntries(deps),
            deps.widgets.get<AutoSignLimits>("sportAutoSignLimits", "/api/sport/auto-sign/limits"),
          ]),
        );
        return {
          active: entries.filter((entry) => ACTIVE.has(entry.status) && !entry.isCancelled).map(entryView),
          auto_quota: { limit: limits.limit, available: limits.available, next_available_at: limits.nextAvailableAt },
        };
      }),
  );
}

interface Link {
  category: string;
  title?: string | null;
  url: string;
  subjectName: string;
  periodKey: string;
  audienceLabel?: string | null;
  status: string;
  score: number;
  author?: { name: string } | null;
}

const linkView = (link: Link) => ({
  category: link.category,
  title: link.title,
  url: link.url,
  subject: link.subjectName,
  period: link.periodKey,
  audience: link.audienceLabel,
  status: link.status === "PUBLISHED" ? undefined : link.status,
  votes: link.score,
  author: link.author?.name,
});

export function registerWidgetsActionTools(server: McpServer, deps: ToolDeps, actions: PendingActions): void {
  server.registerTool(
    "widgets_sport_queue_join_preview",
    {
      title: "Preview: join an ITMO.Widgets sport queue",
      description:
        "Prepares joining an ITMO.Widgets sport queue. queue=free waits for a place in a full lesson (lesson_id " +
        "from itmo_get_sport_schedule); the phone books it when a place frees up, until an hour before the start " +
        "(force: until the end). queue=auto watches the same lesson two weeks after lesson_id and uses the auto " +
        "quota. Nothing changes until itmo_confirm_action. Needs sport:queue.",
      inputSchema: {
        queue: z.enum(["free", "auto"]).describe("free: this lesson; auto: the same lesson two weeks later"),
        lesson_id: z.number().int().positive().describe("lesson_id from itmo_get_sport_schedule"),
        force: z.boolean().optional().describe("free only: keep trying until the lesson ends, not an hour before"),
      },
      annotations: { title: "Preview: join an ITMO.Widgets sport queue", ...PREVIEW },
    },
    ({ queue, lesson_id, force }) =>
      run(async () => {
        const entries = await widgets("sport:queue", () => myEntries(deps));
        const existing = entries.find(
          (entry) =>
            entry.type === queue &&
            ACTIVE.has(entry.status) &&
            !entry.isCancelled &&
            (queue === "free" ? entry.lessonId : entry.prototypeLessonId) === lesson_id,
        );
        if (existing) throw new ToolRefusal(`Already in this queue: entry ${existing.id}, ${existing.position} of ${existing.total}`);

        if (queue === "auto") {
          const limits = await widgets("sport:queue", () =>
            deps.widgets.get<AutoSignLimits>("sportAutoSignLimits", "/api/sport/auto-sign/limits"),
          );
          if (limits.available <= 0) {
            throw new ToolRefusal(`The auto queue quota (${limits.limit}) is used up until about ${limits.nextAvailableAt}`);
          }
          return actions.propose(
            {
              action: `Join the ITMO.Widgets auto queue for the lesson two weeks after ${lesson_id}`,
              details: { lesson_id, auto_quota_left: limits.available },
              warnings: ["Uses one of the auto queue slots; the phone books the place, not this server."],
            },
            () =>
              widgets("sport:queue", async () =>
                entryView(
                  await deps.widgets.post<QueueEntry>("createSportAutoSignEntry", "/api/sport/auto-sign/entry/create", {
                    prototypeLessonId: lesson_id,
                  }),
                ),
              ),
          );
        }

        return actions.propose(
          {
            action: `Join the ITMO.Widgets free-place queue for lesson ${lesson_id}`,
            details: { lesson_id, force: Boolean(force) },
            warnings: ["The phone books the place when one frees up, using a sport enrollment attempt."],
          },
          () =>
            widgets("sport:queue", async () =>
              entryView(
                await deps.widgets.post<QueueEntry>("createSportFreeSignEntry", "/api/sport/free-sign/entry/create", {
                  lessonId: lesson_id,
                  forceSign: Boolean(force),
                }),
              ),
            ),
        );
      }),
  );

  server.registerTool(
    "widgets_sport_queue_leave_preview",
    {
      title: "Preview: leave an ITMO.Widgets sport queue",
      description:
        "Prepares leaving an ITMO.Widgets sport queue (entry_id and queue from widgets_get_sport_queue). Nothing " +
        "changes until itmo_confirm_action. Needs sport:queue.",
      inputSchema: {
        queue: z.enum(["free", "auto"]),
        entry_id: z.number().int().positive().describe("entry_id from widgets_get_sport_queue"),
      },
      annotations: { title: "Preview: leave an ITMO.Widgets sport queue", ...PREVIEW },
    },
    ({ queue, entry_id }) =>
      run(async () => {
        const entries = await widgets("sport:queue", () => myEntries(deps));
        const entry = entries.find((item) => item.type === queue && item.id === entry_id);
        if (!entry || entry.isCancelled || !ACTIVE.has(entry.status)) {
          throw new ToolRefusal("No such active queue entry: check widgets_get_sport_queue");
        }
        return actions.propose(
          { action: `Leave the ITMO.Widgets ${queue} queue (entry ${entry_id})`, details: entryView(entry) },
          async () => {
            await widgets("sport:queue", () =>
              deps.widgets.post(`cancelSport${queue === "free" ? "Free" : "Auto"}SignEntry`, `/api/sport/${queue}-sign/entry/${entry_id}/cancel`),
            );
            return { left_entry_id: entry_id };
          },
        );
      }),
  );
}
