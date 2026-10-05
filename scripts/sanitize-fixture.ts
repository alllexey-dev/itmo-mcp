// Turns a captured API response into a synthetic fixture that keeps only its shape:
// strings become placeholders (date/time formats are preserved), numbers are replaced
// deterministically, booleans and nulls are kept. Usage: tsx scripts/sanitize-fixture.ts in.json out.json
import { readFileSync, writeFileSync } from "node:fs";

const ENVELOPE_KEYS = new Set(["error_code", "code"]);
let counter = 0;

function sanitizeString(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(value)) {
    return value.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, "2026-09-01T10:00");
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "2026-09-01";
  if (/^\d{1,2}:\d{2}$/.test(value)) return "10:00";
  if (/^\d{4}\/\d{4}$/.test(value)) return "2026/2027";
  if (/^Bearer /.test(value)) return "Bearer synthetic";
  if (/^\d+$/.test(value)) return String(100000 + (counter++ % 900000));
  return `synthetic-${counter++}`;
}

function sanitize(value: unknown, key?: string): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (key && ENVELOPE_KEYS.has(key)) return value;
    if (key && /_at$/.test(key)) return 1788000000000;
    return Number.isInteger(value) ? 1000 + (counter++ % 9000) : 12.5;
  }
  if (typeof value === "string") return sanitizeString(value);
  if (Array.isArray(value)) return value.slice(0, 3).map((item) => sanitize(item));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [/^\d+$/.test(k) ? String(Number(k) % 7) : k, sanitize(v, k)]),
  );
}

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Usage: tsx scripts/sanitize-fixture.ts <in.json> <out.json>");
writeFileSync(output, `${JSON.stringify(sanitize(JSON.parse(readFileSync(input, "utf8"))), null, 2)}\n`);
