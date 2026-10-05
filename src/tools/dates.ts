import { z } from "zod";

const TIME_ZONE = "Europe/Moscow";
const DAY_MS = 86_400_000;

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .describe("Date in YYYY-MM-DD (Moscow time)");

/** Today's date in Moscow as YYYY-MM-DD. */
export function today(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(now);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** Resolves an optional range to [from, to], defaulting to `defaultDays` starting today, capped at `maxDays`. */
export function dateRange(
  now: Date,
  from: string | undefined,
  to: string | undefined,
  defaultDays: number,
  maxDays: number,
): { from: string; to: string } {
  const start = from ?? (to ? addDays(to, -(defaultDays - 1)) : today(now));
  const end = to ?? addDays(start, defaultDays - 1);
  const span = daysBetween(start, end);
  if (span < 0) throw new RangeError(`date_to (${end}) is before date_from (${start})`);
  if (span >= maxDays) throw new RangeError(`The range is limited to ${maxDays} days`);
  return { from: start, to: end };
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function weekday(date: string): string {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? "";
}
