// Calls every read-only operation of openapi/*.yaml against the live services with real credentials
// and validates responses against the spec. Prints operation ids, HTTP statuses and schema error
// locations only, never response values. Credentials come from the usual ITMO_* environment variables.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createToolDeps } from "../src/app.js";
import { hasAnyCredentials, loadConfig } from "../src/config.js";
import { formatErrors, loadSpecValidator } from "../test/support/spec.js";

const config = loadConfig();
if (!hasAnyCredentials(config.credentials)) throw new Error("Set ITMO_* credentials, see itmo-mcp --help");
const { my, bars } = createToolDeps({ ...config, stateDir: mkdtempSync(join(tmpdir(), "itmo-mcp-verify-")) });

const specs = {
  my: loadSpecValidator(new URL("../openapi/my-itmo.yaml", import.meta.url).pathname),
  bars: loadSpecValidator(new URL("../openapi/bars.yaml", import.meta.url).pathname),
};
const checked = new Set<string>();
let failures = 0;

async function check<D>(
  spec: keyof typeof specs,
  operationId: string,
  request: Promise<{ data?: D; error?: unknown; response: Response }>,
): Promise<D | undefined> {
  checked.add(`${spec}:${operationId}`);
  const { data, error, response } = await request;
  const body = data ?? error;
  const errors = response.ok ? specs[spec].validateResponse(operationId, body) : [];
  const ok = response.ok && errors.length === 0;
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${spec}:${operationId} HTTP ${response.status}`);
  if (errors.length) console.log(formatErrors(errors.slice(0, 20)).replace(/^/gm, "       "));
  return data;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const from = iso(new Date());
const to = iso(new Date(Date.now() + 6 * 86_400_000));
const range = { query: { date_start: from, date_end: to } };

await check("my", "getPersonalSchedule", my.GET("/api/schedule/schedule/personal", { params: range }));
await check("my", "getScheduleTimeSlots", my.GET("/api/schedule/meta/time_slots"));
const specializations = await check("my", "getRecordBookSpecializations", my.GET("/api/record_book/specializations"));
const program = specializations?.result?.[0];
const semester = program?.semesters.find((s) => s.actual) ?? program?.semesters[0];
if (program && semester) {
  const path = { specializationId: program.main_plan, semester: semester.semester };
  const book = await check("my", "getRecordBook", my.GET("/api/record_book/{specializationId}/{semester}", { params: { path } }));
  const firstSemester = await my.GET("/api/record_book/{specializationId}/{semester}", { params: { path: { ...path, semester: 1 } } });
  const entry = [...(book?.result ?? []), ...(firstSemester.data?.result ?? [])].find((e) => e.have_tree);
  if (entry) {
    await check("my", "getRecordBookControlEntries", my.GET("/api/record_book/{entryId}", { params: { path: { entryId: entry.est_id } } }));
  }
}
const programs = await check("my", "getStudyPlanPrograms", my.GET("/api/eduPlanNew/programs"));
const plan = programs?.result?.programs.find((p) => p.isActive) ?? programs?.result?.programs[0];
if (plan) {
  await check("my", "getStudyPlan", my.GET("/api/eduPlanNew/study_plan/{planId}", {
    params: { path: { planId: plan.planId }, query: plan.specializationId ? { spec_id: plan.specializationId } : {} },
  }));
}
const isu = (await my.GET("/api/eduPlanNew/programs")).data?.result?.isu;
if (isu) await check("my", "getPerson", my.GET("/api/personalities/persons/{isu}", { params: { path: { isu } } }));
await check("my", "searchPersons", my.GET("/api/personalities/persons", { params: { query: { q: "Иванов", limit: 5, offset: 0 } } }));
await check("my", "getSportScore", my.GET("/api/sport/personal/score"));
await check("my", "getSportSemesters", my.GET("/api/sport/semesters/list"));
await check("my", "getCurrentSportSemester", my.GET("/api/sport/semesters/current"));
await check("my", "getSportScheduleFilters", my.GET("/api/sport/sign/schedule/filters"));
await check("my", "getSportSchedule", my.GET("/api/sport/sign/schedule", { params: range }));
await check("my", "getSportCalendar", my.GET("/api/sport/personal/calendar", {
  params: { query: { date_start: iso(new Date(Date.now() - 60 * 86_400_000)), date_end: to } },
}));
await check("my", "getSportChosen", my.GET("/api/sport/sign/chosen"));
await check("my", "getSportAttempts", my.GET("/api/sport/personal/have_attempts"));
await check("my", "getSportDebt", my.GET("/api/sport/personal/debt"));
await check("my", "getSportTypes", my.GET("/api/sport/sport_types"));
await check("my", "getSportCompetitions", my.GET("/api/sport/competitions/list"));
await check("my", "getSportHealthLevel", my.GET("/api/sport/personal/health_level"));
await check("my", "getScholarshipTotal", my.GET("/api/finances/scholarship/total", {
  params: { query: { dateFrom: `${new Date().getFullYear() - 1}-01-01`, dateTo: from } },
}));
await check("my", "getScholarshipIncome", my.GET("/api/finances/scholarship/income"));
await check("my", "getEduPaymentContracts", my.GET("/api/finances/edupayments/contracts"));
await check("my", "getEduPayments", my.GET("/api/finances/edupayments/payments"));
await check("my", "getMyRequests", my.GET("/api/requests/my"));
await check("my", "getDormitoryStatus", my.GET("/api/dormitory/status/full"));
const periods = await check("my", "getDormitoryPaymentPeriods", my.GET("/api/dormitory/payments/contracts/periods"));
const period = periods?.result?.[0];
if (period) {
  await check("my", "getDormitoryContracts", my.GET("/api/dormitory/payments/contracts", {
    params: { query: { from: period.dateFrom, to: period.dateTo } },
  }));
}
await check("my", "getMyRoomBookings", my.GET("/api/booking/bookings/my"));
await check("my", "getCurrentQueueEntries", my.GET("/api/queues/current"));
await check("my", "getArchivedQueueEntries", my.GET("/api/queues/archive"));
await check("my", "getElectionAvailability", my.GET("/api/election/students/availability"));

await check("bars", "getCurrentUser", bars.GET("/users/current_user/"));
await check("bars", "getConfig", bars.GET("/config/"));
const disciplines = await check("bars", "getDisciplines", bars.GET("/journal/disciplines", { params: { query: { withCheckpointPlansOnly: true } } }));
const checkpointPlanId = disciplines?.[0]?.checkpoint_plan_ids[0];
if (checkpointPlanId) {
  const groups = await check("bars", "getGroupsAndFlows", bars.GET("/journal/groups-and-flows", { params: { query: { checkpointPlanId } } }));
  const group = groups?.[0];
  if (group) {
    await check("bars", "getStudentJournal", bars.GET("/marks/{checkpointPlanId}/{type}/{identifier}/student", {
      params: { path: { checkpointPlanId, type: group.type, identifier: group.identifier } },
    }));
  }
}

const skipped = Object.entries(specs).flatMap(([name, spec]) =>
  spec.operationIds().filter((id) => id !== "barsLogin" && !checked.has(`${name}:${id}`)).map((id) => `${name}:${id}`),
);
if (skipped.length) console.log(`not checked (no data for this account): ${skipped.join(", ")}`);
console.log(failures ? `${failures} operation(s) failed` : "all checked operations match the spec");
process.exit(failures ? 1 : 0);
