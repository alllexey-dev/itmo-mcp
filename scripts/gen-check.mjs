// Fails when src/generated/* is out of date with openapi/*.yaml.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "itmo-mcp-gen-"));
let stale = false;
for (const name of ["my-itmo", "bars"]) {
  const out = join(dir, `${name}.ts`);
  execFileSync("npx", ["openapi-typescript", `openapi/${name}.yaml`, "-o", out], { stdio: "ignore" });
  if (readFileSync(out, "utf8") !== readFileSync(`src/generated/${name}.ts`, "utf8")) {
    console.error(`src/generated/${name}.ts is stale: run npm run gen`);
    stale = true;
  }
}
process.exit(stale ? 1 : 0);
