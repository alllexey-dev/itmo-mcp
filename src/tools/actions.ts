import { randomBytes } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { run, ToolRefusal } from "./format.js";

const TTL_MS = 10 * 60_000;

interface PendingAction {
  title: string;
  expiresAt: number;
  execute(): Promise<unknown>;
}

export interface ActionPreview {
  action: string;
  details: unknown;
  warnings?: string[];
}

/**
 * Changes prepared by preview tools and waiting for the user's confirmation. Tokens are single-use
 * and expire after 10 minutes; they live in memory, so a restart drops them.
 */
export class PendingActions {
  private readonly pending = new Map<string, PendingAction>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs: number = TTL_MS,
  ) {}

  /** Stores the action and returns the preview the agent must show to the user before confirming. */
  propose(preview: ActionPreview, execute: () => Promise<unknown>) {
    this.prune();
    const token = randomBytes(12).toString("base64url");
    const expiresAt = this.now() + this.ttlMs;
    this.pending.set(token, { title: preview.action, expiresAt, execute });
    return {
      ...preview,
      confirmation_token: token,
      expires_at: new Date(expiresAt).toISOString(),
      next_step:
        "Nothing has been changed yet. Show this preview to the user and call itmo_confirm_action " +
        "with confirmation_token only after the user explicitly agrees.",
    };
  }

  /** Removes and returns the action; unknown, used and expired tokens are refused. */
  take(token: string): PendingAction {
    this.prune();
    const action = this.pending.get(token);
    if (!action) throw new ToolRefusal("Unknown or expired confirmation_token: run the preview tool again");
    this.pending.delete(token);
    return action;
  }

  private prune(): void {
    const now = this.now();
    for (const [token, action] of this.pending) if (action.expiresAt <= now) this.pending.delete(token);
  }
}

export function registerConfirmTool(server: McpServer, actions: PendingActions): void {
  server.registerTool(
    "itmo_confirm_action",
    {
      title: "Confirm an ITMO action",
      description:
        "Carries out an action prepared by a *_preview tool (enroll in a sport lesson, book a room, submit a request, " +
        "cancel). Call it only after showing the preview to the user and getting their explicit consent.",
      inputSchema: { confirmation_token: z.string().min(8).describe("confirmation_token from the preview") },
      annotations: {
        title: "Confirm an ITMO action",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    ({ confirmation_token }) =>
      run(async () => {
        const action = actions.take(confirmation_token);
        return { done: action.title, result: await action.execute() };
      }),
  );
}
