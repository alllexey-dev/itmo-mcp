import { BarsSession } from "./auth/bars-session.js";
import { ItmoIdClient } from "./auth/itmo-id.js";
import { botUserAgent, browserUserAgent, currentPlatform } from "./auth/session-label.js";
import { SsoLogin } from "./auth/sso.js";
import { StateStore } from "./auth/state-store.js";
import { TokenManager } from "./auth/token-manager.js";
import { createBarsClient } from "./clients/bars.js";
import { createMyItmoClient } from "./clients/my-itmo.js";
import type { Config } from "./config.js";
import type { FetchFn } from "./http.js";
import { PendingActions } from "./tools/actions.js";
import { ToolAvailability } from "./tools/availability.js";
import type { ToolDeps } from "./tools/deps.js";
import { VERSION } from "./version.js";
import { WidgetsClient } from "./widgets/client.js";
import { forgetConnection } from "./widgets/pairing.js";

/** The UA of this server's own ITMO.ID sign-ins (ITMO_BROWSER_UA): desktop Chrome or the honest bot label. */
export function signInUserAgent(config: Pick<Config, "browserUserAgent">): string {
  const platform = currentPlatform();
  return config.browserUserAgent ? browserUserAgent(platform) : botUserAgent("MCP", undefined, VERSION, platform);
}

/**
 * The state file, ITMO.ID and the ITMO.Widgets connection. A Backend 401 means the connection was revoked: the
 * server ends its own ITMO.ID session and forgets the pairing.
 */
export function createConnection(config: Config, fetchFn: FetchFn = fetch) {
  const store = new StateStore(config.stateDir);
  const idClient = new ItmoIdClient(fetchFn, undefined, undefined, signInUserAgent(config));
  const availability = new ToolAvailability(store, config.credentials.keycloakIdentity);
  const token = async () => (await store.read()).connection?.token;
  const widgets = new WidgetsClient(config.widgetsUrl, token, fetchFn, async () => {
    await forgetConnection(store, idClient);
    await availability.refresh();
  });
  return { store, idClient, widgets, availability };
}

/** Wires authentication and API clients for one ITMO account; share it between MCP sessions. */
export function createToolDeps(config: Config, fetchFn: FetchFn = fetch): ToolDeps {
  const { store, idClient, widgets, availability } = createConnection(config, fetchFn);
  const sso = new SsoLogin(idClient, store, config.credentials, () => availability.identitiesRejected());
  const tokens = new TokenManager(idClient, sso, store, config.credentials, Date.now, async () => {
    await widgets.reportStatus("closed").catch(() => undefined);
  });
  return {
    my: createMyItmoClient({ tokens, fetchFn }),
    bars: createBarsClient({ session: new BarsSession(sso, fetchFn), fetchFn }),
    widgets,
    isu: () => tokens.isu(),
    now: () => new Date(),
    actions: config.writesEnabled ? new PendingActions() : undefined,
    availability,
  };
}
