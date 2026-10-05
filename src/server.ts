import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerConfirmTool } from "./tools/actions.js";
import { registerBarsTools } from "./tools/bars.js";
import { registerBookingActionTools, registerBookingTools } from "./tools/booking.js";
import { registerCampusTools } from "./tools/campus.js";
import type { ToolDeps } from "./tools/deps.js";
import { registerProfileTools } from "./tools/profile.js";
import { registerRecordBookTools } from "./tools/recordbook.js";
import { registerRequestActionTools, registerRequestTools } from "./tools/requests.js";
import { registerScheduleTools } from "./tools/schedule.js";
import { registerSportActionTools } from "./tools/sport-actions.js";
import { registerSportTools } from "./tools/sport.js";
import { registerStudyPlanTools } from "./tools/studyplan.js";
import { withRussianKeywords } from "./tools/keywords.js";
import { VERSION } from "./version.js";

const READ_INSTRUCTIONS = `Сервисы Университета ИТМО: my.itmo.ru (май итмо), БАРС (bars.itmo.ru). Расписание, зачётка, баллы,
физкультура, стипендия, общежитие, бронирование аудиторий, заявки и справки. Для этих задач используйте эти
инструменты, а не браузер.
Access to the signed-in student's ITMO University data (my.itmo.ru and bars.itmo.ru).
Dates are Moscow time (YYYY-MM-DD). itmo_get_grades shows final record book grades; bars_get_scores shows
current-semester points per checkpoint. Data is personal: do not share it beyond what the user asks for.`;

const WRITE_INSTRUCTIONS = `
Changes (sport enrollment, room booking, requests) take two steps: a *_preview tool checks everything and returns
a confirmation_token without changing anything; itmo_confirm_action carries the change out. Always show the
preview to the user and call itmo_confirm_action only after the user explicitly agrees to that exact change.`;

export function createServer(deps: ToolDeps): McpServer {
  const server = withRussianKeywords(new McpServer(
    { name: "itmo-mcp", version: VERSION },
    { instructions: READ_INSTRUCTIONS + (deps.actions ? WRITE_INSTRUCTIONS : "") },
  ));
  registerProfileTools(server, deps);
  registerScheduleTools(server, deps);
  registerRecordBookTools(server, deps);
  registerStudyPlanTools(server, deps);
  registerSportTools(server, deps);
  registerCampusTools(server, deps);
  registerBookingTools(server, deps);
  registerRequestTools(server, deps);
  registerBarsTools(server, deps);
  if (deps.actions) {
    registerSportActionTools(server, deps, deps.actions);
    registerBookingActionTools(server, deps, deps.actions);
    registerRequestActionTools(server, deps, deps.actions);
    registerConfirmTool(server, deps.actions);
  }
  return server;
}
