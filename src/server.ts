import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerBarsTools } from "./tools/bars.js";
import { registerCampusTools } from "./tools/campus.js";
import type { ToolDeps } from "./tools/deps.js";
import { registerProfileTools } from "./tools/profile.js";
import { registerRecordBookTools } from "./tools/recordbook.js";
import { registerScheduleTools } from "./tools/schedule.js";
import { registerSportTools } from "./tools/sport.js";
import { registerStudyPlanTools } from "./tools/studyplan.js";
import { VERSION } from "./version.js";

const INSTRUCTIONS = `Read-only access to the signed-in student's ITMO University data (my.itmo.ru and bars.itmo.ru).
Dates are Moscow time (YYYY-MM-DD). itmo_get_grades shows final record book grades; bars_get_scores shows
current-semester points per checkpoint. Data is personal: do not share it beyond what the user asks for.`;

export function createServer(deps: ToolDeps): McpServer {
  const server = new McpServer({ name: "itmo-mcp", version: VERSION }, { instructions: INSTRUCTIONS });
  registerProfileTools(server, deps);
  registerScheduleTools(server, deps);
  registerRecordBookTools(server, deps);
  registerStudyPlanTools(server, deps);
  registerSportTools(server, deps);
  registerCampusTools(server, deps);
  registerBarsTools(server, deps);
  return server;
}
