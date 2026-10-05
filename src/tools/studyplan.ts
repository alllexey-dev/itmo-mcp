import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { result } from "../clients/my-itmo.js";
import type { components } from "../generated/my-itmo.js";
import type { ToolDeps } from "./deps.js";
import { READ_ONLY, run } from "./format.js";

type StudyPlanNode = components["schemas"]["StudyPlanNode"];

export function registerStudyPlanTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "itmo_get_study_plan",
    {
      title: "Study plan",
      description:
        "Disciplines of the student's study plan for one semester: credits, hours by activity, department, " +
        "language and whether it is an elective. Defaults to the current semester.",
      inputSchema: {
        semester: z.number().int().min(1).optional().describe("Sequential semester number (1, 2, ...)"),
      },
      annotations: { title: "Study plan", ...READ_ONLY },
    },
    ({ semester }) =>
      run(async () => {
        const programs = await result("getStudyPlanPrograms", deps.my.GET("/api/eduPlanNew/programs"));
        const program = programs?.programs.find((p) => p.isActive) ?? programs?.programs[0];
        if (!program) return { message: "No study plan is available for this account." };
        const plan = await result(
          "getStudyPlan",
          deps.my.GET("/api/eduPlanNew/study_plan/{planId}", {
            params: {
              path: { planId: program.planId },
              query: program.specializationId ? { spec_id: program.specializationId } : {},
            },
          }),
        );
        if (!plan) return undefined;
        const chosen = semester ?? plan.currentSemester ?? 1;
        return {
          program: program.name,
          direction: plan.planInfo && `${plan.planInfo.directionCode} ${plan.planInfo.directionName}`,
          qualification: plan.planInfo?.levelQualification,
          start_year: plan.planInfo?.startYear,
          current_semester: plan.currentSemester,
          semesters_total: plan.semestersCount,
          semester: chosen,
          disciplines: disciplinesFor(plan.structure ?? [], chosen),
        };
      }),
  );
}

function disciplinesFor(nodes: StudyPlanNode[], semester: number, module?: string): unknown[] {
  return nodes.flatMap((node) => {
    if (node.type !== "discipline") return disciplinesFor(node.children ?? [], semester, node.name);
    const contents = node.contents?.[String(semester)];
    if (!contents?.length) return [];
    return [
      {
        name: node.name,
        module,
        credits: contents.reduce((sum, c) => sum + (c.creditPoints ?? 0), 0) || node.creditPoints,
        hours: Object.fromEntries(
          contents.flatMap((c) => c.activities ?? []).map((a) => [a.name, a.volume ?? true]),
        ),
        elective: node.choiceAvailable || undefined,
        department: node.department?.name,
        language: node.langName,
        syllabus: node.rpdUrl,
      },
    ];
  });
}
