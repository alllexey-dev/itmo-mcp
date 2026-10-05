// Validates research/openapi/examples/<operationId>.json against research/openapi/*.yaml.
// Specs may reference ../../openapi/*.yaml; both directories are loaded so references resolve.
// Run from the repository root: npx tsx research/tools/validate-examples.ts
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse } from "yaml";

const root = resolve(import.meta.dirname, "..", "..");
const base = "https://itmo-mcp.invalid/";
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
ajv.addFormat("int32", true);
ajv.addFormat("int64", true);

const specs = ["openapi", "research/openapi"].flatMap((dir) =>
  readdirSync(join(root, dir))
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => join(dir, f)),
);
for (const spec of specs) ajv.addSchema({ ...parse(readFileSync(join(root, spec), "utf8")), $id: base + spec });

const escape = (s: string) => s.replaceAll("~", "~0").replaceAll("/", "~1");
const examplesDir = join(root, "research/openapi/examples");
let failures = 0;
for (const spec of specs.filter((s) => s.startsWith("research/"))) {
  const doc = parse(readFileSync(join(root, spec), "utf8"));
  for (const [path, item] of Object.entries<Record<string, { operationId?: string }>>(doc.paths)) {
    for (const [method, op] of Object.entries(item)) {
      if (!op?.operationId) continue;
      const file = join(examplesDir, `${op.operationId}.json`);
      let body: unknown;
      try {
        body = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        console.log(`skip ${op.operationId} (no example)`);
        continue;
      }
      const pointer = ["paths", path, method, "responses", "200", "content", "application/json", "schema"].map(escape).join("/");
      const validate = ajv.compile({ $ref: `${base}${spec}#/${pointer}` });
      const ok = validate(body);
      if (!ok) failures += 1;
      console.log(`${ok ? "ok  " : "FAIL"} ${op.operationId} (${relative(root, file)})`);
      for (const e of validate.errors ?? []) console.log(`     ${e.instancePath || "/"} ${e.keyword} ${e.message ?? ""}`);
    }
  }
}
process.exit(failures ? 1 : 0);
