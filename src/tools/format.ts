import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AuthError } from "../auth/errors.js";
import { ItmoApiError } from "../clients/errors.js";

/** A request the tool refuses to carry out; the message explains why to the user. */
export class ToolRefusal extends Error {
  override readonly name = "ToolRefusal";
}

/** Drops null, undefined, empty strings, empty arrays and empty objects to keep tool output small. */
export function compact(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(compact).filter((item) => item !== undefined);
    return items.length ? items : undefined;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .map(([key, item]) => [key, compact(item)] as const)
      .filter(([, item]) => item !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  if (value === null || value === "") return undefined;
  return value;
}

export function toolResult(data: unknown): CallToolResult {
  const body = compact(data);
  return { content: [{ type: "text", text: body === undefined ? "No data." : JSON.stringify(body) }] };
}

export function toolError(error: unknown): CallToolResult {
  const message =
    error instanceof AuthError ||
    error instanceof ItmoApiError ||
    error instanceof RangeError ||
    error instanceof ToolRefusal
      ? error.message
      : `Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Runs a tool body and converts thrown errors into MCP error results. */
export async function run(body: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return toolResult(await body());
  } catch (error) {
    return toolError(error);
  }
}

export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

/** Annotations of a preview tool: it only reads, the change happens in itmo_confirm_action. */
export const PREVIEW = READ_ONLY;
