import { BarsSession } from "./auth/bars-session.js";
import { ItmoIdClient } from "./auth/itmo-id.js";
import { SsoLogin } from "./auth/sso.js";
import { StateStore } from "./auth/state-store.js";
import { TokenManager } from "./auth/token-manager.js";
import { createBarsClient } from "./clients/bars.js";
import { createMyItmoClient } from "./clients/my-itmo.js";
import type { Config } from "./config.js";
import type { FetchFn } from "./http.js";
import { PendingActions } from "./tools/actions.js";
import type { ToolDeps } from "./tools/deps.js";

/** Wires authentication and API clients for one ITMO account; share it between MCP sessions. */
export function createToolDeps(config: Config, fetchFn: FetchFn = fetch): ToolDeps {
  const store = new StateStore(config.stateDir);
  const idClient = new ItmoIdClient(fetchFn);
  const sso = new SsoLogin(idClient, store, config.credentials);
  const tokens = new TokenManager(idClient, sso, store, config.credentials);
  return {
    my: createMyItmoClient({ tokens, fetchFn }),
    bars: createBarsClient({ session: new BarsSession(sso, fetchFn), fetchFn }),
    isu: () => tokens.isu(),
    now: () => new Date(),
    actions: config.writesEnabled ? new PendingActions() : undefined,
  };
}
