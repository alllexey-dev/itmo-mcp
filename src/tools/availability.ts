import type { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { StateStore } from "../auth/state-store.js";

/**
 * Which optional tool groups can work right now, so the client only sees tools it can use: `bars_*` needs a
 * KEYCLOAK_IDENTITY (stored or from env) that ITMO.ID has not rejected, `widgets_*` a pairing with ITMO.Widgets.
 * Optimistic until the first `refresh()`, so a server built without one keeps every tool.
 */
export class ToolAvailability {
  private bars = true;
  private widgets = true;
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

  /** Re-reads the state file (a `pair` in another process, a rotated cookie) and notifies on a change. */
  async refresh(): Promise<void> {
    const state = await this.store.read();
    const identities = identityKey(state.keycloakIdentity, this.envIdentity);
    this.set(identities !== "" && identities !== this.rejected, Boolean(state.connection));
  }

  /** ITMO.ID rejected every known cookie: hide the BARS tools until a new cookie arrives. */
  async identitiesRejected(): Promise<void> {
    const state = await this.store.read();
    this.rejected = identityKey(state.keycloakIdentity, this.envIdentity);
    await this.refresh();
  }

  /** Shows or hides the registered `bars_*` and `widgets_*` tools now and on every change; returns the unsubscribe. */
  apply(tools: ReadonlyMap<string, RegisteredTool>): () => void {
    const sync = () => {
      for (const [name, tool] of tools) {
        const on = name.startsWith("bars_") ? this.bars : name.startsWith("widgets_") ? this.widgets : true;
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

  private set(bars: boolean, widgets: boolean): void {
    if (bars === this.bars && widgets === this.widgets) return;
    this.bars = bars;
    this.widgets = widgets;
    for (const listener of this.listeners) listener();
  }
}

function identityKey(...values: (string | undefined)[]): string {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort().join("\n");
}
