import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { bars } from "../clients/bars.js";
import type { components } from "../generated/bars.js";
import type { ToolDeps } from "./deps.js";
import { READ_ONLY, run } from "./format.js";

type Journal = components["schemas"]["StudentJournal"];
type Checkpoint = components["schemas"]["Checkpoint"];
type Mark = components["schemas"]["Mark"];

const CONCURRENCY = 4;

export function registerBarsTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "bars_get_scores",
    {
      title: "BARS points",
      description:
        "Current-semester points from BARS (bars.itmo.ru): total per discipline and points per checkpoint " +
        "(labs, tests, exam) with min/max. Optionally filter by discipline name.",
      inputSchema: {
        discipline: z.string().optional().describe("Case-insensitive part of a discipline name"),
      },
      annotations: { title: "BARS points", ...READ_ONLY },
    },
    ({ discipline }) =>
      run(async () => {
        const [user, disciplines] = await Promise.all([
          bars("getCurrentUser", deps.bars.GET("/users/current_user/")),
          bars("getDisciplines", deps.bars.GET("/journal/disciplines", { params: { query: { withCheckpointPlansOnly: true } } })),
        ]);
        const needle = discipline?.toLocaleLowerCase();
        const selected = disciplines.filter((d) => !needle || d.name.toLocaleLowerCase().includes(needle));
        const plans = selected.flatMap((d) => d.checkpoint_plan_ids.map((planId) => ({ discipline: d.name, planId })));
        const journals = await mapLimit(plans, CONCURRENCY, ({ planId }) => studentJournal(deps, planId));
        return {
          period: { year: user.selected_year, term: user.selected_term === 1 ? "autumn" : "spring" },
          disciplines: plans.map((plan, i) => journalView(plan.discipline, journals[i])),
        };
      }),
  );
}

async function studentJournal(deps: ToolDeps, checkpointPlanId: number): Promise<Journal | undefined> {
  const groups = await bars(
    "getGroupsAndFlows",
    deps.bars.GET("/journal/groups-and-flows", { params: { query: { checkpointPlanId } } }),
  );
  const group = groups[0];
  if (!group) return undefined;
  return bars(
    "getStudentJournal",
    deps.bars.GET("/marks/{checkpointPlanId}/{type}/{identifier}/student", {
      params: { path: { checkpointPlanId, type: group.type, identifier: group.identifier } },
    }),
  );
}

function journalView(name: string, journal: Journal | undefined) {
  const marks = journal?.students[0]?.marks;
  const plan = journal?.headers.plan;
  const byCheckpoint = new Map<number, Mark>();
  for (const mark of marks?.regular ?? []) if (mark.checkpoint_id) byCheckpoint.set(mark.checkpoint_id, mark);
  const checkpoint = (c: Checkpoint) => ({
    name: c.name,
    week: c.week,
    points: byCheckpoint.get(c.id)?.mark ?? undefined,
    absent: byCheckpoint.get(c.id)?.is_absent || undefined,
    min: c.min_grade,
    max: c.max_grade,
    key: c.key || undefined,
  });
  return {
    discipline: name,
    total: marks?.total,
    current_sum: marks?.regularSum,
    additional: marks?.additional?.mark,
    exam: marks?.final?.mark,
    final_grade: marks?.active_approvals?.find((a) => a.is_active)?.mark_string,
    checkpoints: plan?.regular_checkpoints?.map(checkpoint),
    final_checkpoint: plan?.final_checkpoint ? checkpoint(plan.final_checkpoint) : undefined,
  };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
