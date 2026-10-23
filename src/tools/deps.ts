import type { BarsClient } from "../clients/bars.js";
import type { MyItmoClient } from "../clients/my-itmo.js";
import type { WidgetsClient } from "../widgets/client.js";
import type { PendingActions } from "./actions.js";
import type { ToolAvailability } from "./availability.js";

export interface ToolDeps {
  my: MyItmoClient;
  bars: BarsClient;
  /** ITMO.Widgets API of the paired connection (`itmo-mcp pair`). */
  widgets: WidgetsClient;
  /** ISU number of the signed-in user. */
  isu(): Promise<number>;
  now(): Date;
  /** Present only when write tools are enabled. */
  actions?: PendingActions;
  /** Hides `bars_*` and `widgets_*` tools that cannot work; absent, every tool stays listed. */
  availability?: ToolAvailability;
}
