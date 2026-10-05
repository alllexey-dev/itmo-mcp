import type { BarsClient } from "../clients/bars.js";
import type { MyItmoClient } from "../clients/my-itmo.js";

export interface ToolDeps {
  my: MyItmoClient;
  bars: BarsClient;
  /** ISU number of the signed-in user. */
  isu(): Promise<number>;
  now(): Date;
}
