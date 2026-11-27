import type { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ssoIdentities } from "../auth/sso.js";
import type { StateStore } from "../auth/state-store.js";

/** Takes part in every change, so it is never hidden: it also confirms `widgets_*` previews. */
const CONFIRM_TOOL = "itmo_confirm_action";

/**
 * Which optional tool groups can work right now, so the client only sees tools it can use: `bars_*` needs a
 * KEYCLOAK_IDENTITY that ITMO.ID has not rejected (the paired session's with the `itmo:sso` grant, else stored or
 * from env), `widgets_*` a pairing with ITMO.Widgets, and `itmo_*` an ITMO sign-in: a pairing without any ITMO
 * grant leaves only `widgets_*`. Optimistic until the first `refresh()`, so a server built without one keeps every
 * tool.
 */
export class ToolAvailability {
  private bars = true;
  private widgets = true;
  private myItmo = true;
  /** The cookies ITMO.ID rejected last; BARS comes back only with a different cookie. */
  private rejected?: string;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly store: StateStore,
    private readonly envIdentity?: string,
  ) {}

  get barsAvailable(): boolean {
    return this.bars;
  }

  get widgetsAvailable(): boolean {
    return this.widgets;
  }

  get myItmoAvailable(): boolean {
    return this.myItmo;
  }

  /** Re-reads the state file (a `pair` in another process, a rotated cookie) and notifies on a change. */
  async refresh(): Promise<void> {
    const state = await this.store.read();
    const identities = identityKey(...ssoIdentities(state, this.envIdentity));
    this.set(identities !== "" && identities !== this.rejected, Boolean(state.connection), !state.connection || Boolean(state.connection.itmo));
  }

  /** ITMO.ID rejected every known cookie: hide the BARS tools until a new cookie arrives. */
  async identitiesRejected(): Promise<void> {
    const state = await this.store.read();
    this.rejected = identityKey(...ssoIdentities(state, this.envIdentity));
    await this.refresh();
  }

  /** Shows or hides the registered `bars_*`, `widgets_*` and `itmo_*` tools now and on every change; returns the unsubscribe. */
  apply(tools: ReadonlyMap<string, RegisteredTool>): () => void {
    const sync = () => {
      for (const [name, tool] of tools) {
        const on = name.startsWith("bars_")
          ? this.bars
          : name.startsWith("widgets_")
            ? this.widgets
            : name.startsWith("itmo_") && name !== CONFIRM_TOOL
              ? this.myItmo
              : true;
        if (tool.enabled === on) continue;
        if (on) tool.enable();
        else tool.disable();
      }
    };
    sync();
    this.listeners.add(sync);
    return () => {
      this.listeners.delete(sync);
    };
  }

  private set(bars: boolean, widgets: boolean, myItmo: boolean): void {
    if (bars === this.bars && widgets === this.widgets && myItmo === this.myItmo) return;
    this.bars = bars;
    this.widgets = widgets;
    this.myItmo = myItmo;
    for (const listener of this.listeners) listener();
  }
}

function identityKey(...values: (string | undefined)[]): string {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort().join("\n");
}
