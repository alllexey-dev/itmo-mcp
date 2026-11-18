// The source of truth for openapi/*.yaml is the my-itmo-api repository (spec/openapi/).
// `node scripts/sync-spec.mjs` copies the two specifications this server is generated from;
// `--check` only compares and exits 1 when the local copy differs.
// Set SPEC_SOURCE to a local my-itmo-api checkout to read from disk instead of GitHub.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const upstream = "https://raw.githubusercontent.com/alllexey-dev/my-itmo-api/master/spec/openapi";
const check = process.argv.includes("--check");
const local = process.env.SPEC_SOURCE;

async function read(name) {
  if (local) return readFileSync(join(local, "spec/openapi", name), "utf8");
  const response = await fetch(`${upstream}/${name}`);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status} from my-itmo-api`);
  return response.text();
}

let stale = false;
for (const name of ["my-itmo.yaml", "bars.yaml"]) {
  const source = await read(name);
  const path = join("openapi", name);
  if (readFileSync(path, "utf8") === source) {
    console.log(`${path}: up to date`);
  } else if (check) {
    console.error(`${path} differs from my-itmo-api: run npm run spec:sync, then npm run gen`);
    stale = true;
  } else {
    writeFileSync(path, source);
    console.log(`${path}: updated, now run npm run gen`);
  }
}
process.exit(stale ? 1 : 0);
