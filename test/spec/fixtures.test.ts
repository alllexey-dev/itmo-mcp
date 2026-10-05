import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatErrors, loadSpecValidator } from "../support/spec.js";

const fixture = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/${path}`, import.meta.url), "utf8"));

const specPath = (name: string) => new URL(`../../openapi/${name}.yaml`, import.meta.url).pathname;

const cases: Record<string, [operationId: string, fixture: string][]> = {
  "my-itmo": [
    ["getPersonalSchedule", "my-itmo/schedule/personal.json"],
    ["getPersonalSchedule", "my-itmo/schedule/empty.json"],
    ["getScheduleTimeSlots", "my-itmo/schedule/time-slots.json"],
    ["getRecordBookSpecializations", "my-itmo/recordbook/specializations.json"],
    ["getStudyPlanPrograms", "my-itmo/studyplan/programs.json"],
    ["getStudyPlanPrograms", "my-itmo/studyplan/empty-programs.json"],
    ["getStudyPlan", "my-itmo/studyplan/study-plan.json"],
    ["getStudyPlan", "my-itmo/studyplan/absence.json"],
    ["getPerson", "my-itmo/personalities/student.json"],
    ["getPerson", "my-itmo/personalities/employee.json"],
    ["getPerson", "my-itmo/personalities/service.json"],
    ["getPerson", "my-itmo/personalities/person.json"],
    ["searchPersons", "my-itmo/personalities/search.json"],
    ["searchPersons", "my-itmo/personalities/search-empty.json"],
    ["getSportScore", "my-itmo/sport/score.json"],
    ["getSportScore", "my-itmo/sport/score-empty.json"],
    ["getSportSemesters", "my-itmo/sport/semesters.json"],
    ["getCurrentSportSemester", "my-itmo/sport/current-semester.json"],
    ["getSportScheduleFilters", "my-itmo/sport/filters.json"],
    ["getSportSchedule", "my-itmo/sport/schedule.json"],
    ["getSportSchedule", "my-itmo/sport/external-venue.json"],
    ["getSportCalendar", "my-itmo/sport/calendar.json"],
    ["getSportCalendar", "my-itmo/sport/calendar-empty.json"],
    ["getSportChosen", "my-itmo/sport/chosen.json"],
    ["getSportAttempts", "my-itmo/sport/attempts.json"],
    ["getSportDebt", "my-itmo/sport/debt.json"],
    ["getSportDebt", "my-itmo/sport/debt-none.json"],
    ["getSportTypes", "my-itmo/sport/sport-types.json"],
    ["getSportHealthLevel", "my-itmo/sport/health-level.json"],
    ["getSportCompetitions", "my-itmo/sport/competitions.json"],
    ["getScholarshipTotal", "my-itmo/finances/totals.json"],
    ["getScholarshipTotal", "my-itmo/finances/empty.json"],
    ["getScholarshipIncome", "my-itmo/finances/income.json"],
    ["getMyRequests", "my-itmo/requests/my.json"],
    ["getMyRequests", "my-itmo/requests/empty.json"],
    ["getDormitoryStatus", "my-itmo/dormitory/status.json"],
    ["getDormitoryPaymentPeriods", "my-itmo/dormitory/periods.json"],
    ["getDormitoryContracts", "my-itmo/dormitory/contracts.json"],
    ["getMyRoomBookings", "my-itmo/booking/my.json"],
    ["getArchivedQueueEntries", "my-itmo/queues/archive.json"],
    ["getElectionAvailability", "my-itmo/election/availability.json"],
  ],
  bars: [
    ["getCurrentUser", "bars/user.json"],
    ["getConfig", "bars/config.json"],
    ["getDisciplines", "bars/disciplines.json"],
    ["getDisciplines", "bars/empty-disciplines.json"],
    ["getGroupsAndFlows", "bars/groups.json"],
    ["getGroupsAndFlows", "bars/groups-live.json"],
    ["getGroupsAndFlows", "bars/empty-groups.json"],
    ["getStudentJournal", "bars/journal.json"],
    ["getStudentJournal", "bars/empty-journal.json"],
  ],
};

for (const [spec, table] of Object.entries(cases)) {
  describe(`${spec} spec matches fixtures`, () => {
    const validator = loadSpecValidator(specPath(spec));

    it.each(table)("%s accepts %s", (operationId, path) => {
      const errors = validator.validateResponse(operationId, fixture(path));
      expect(formatErrors(errors)).toBe("");
    });
  });
}
