import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StateStore } from "../../src/auth/state-store.js";

const tempDir = () => join(mkdtempSync(join(tmpdir(), "itmo-mcp-test-")), "nested");

describe("StateStore", () => {
  it("returns an empty state when nothing is stored", async () => {
    expect(await new StateStore(tempDir()).read()).toEqual({});
  });

  it("merges updates and writes an owner-only file", async () => {
    const dir = tempDir();
    const store = new StateStore(dir);

    await Promise.all([store.update({ refreshToken: "r" }), store.update({ keycloakIdentity: "k" })]);

    expect(await new StateStore(dir).read()).toEqual({ refreshToken: "r", keycloakIdentity: "k" });
    expect(statSync(join(dir, "state.json")).mode & 0o777).toBe(0o600);
  });
});
