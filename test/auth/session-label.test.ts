import { describe, expect, it } from "vitest";
import { botUserAgent, browserUserAgent } from "../../src/auth/session-label.js";

// Vectors shared with MyItmoApi ItmoSessionLabelTest (observed on id.itmo.ru/activity).
describe("session label", () => {
  it("builds the honest bot label", () => {
    expect(botUserAgent("agent", undefined, "1.0", "linux")).toBe("ITMO Widgets agent bot/1.0 (X11; Linux x86_64)");
    expect(botUserAgent("MCP", "", "0.3")).toBe("ITMO Widgets MCP bot/0.3");
    expect(botUserAgent("MCP", "laptop", "2.0.1", "macos")).toBe(
      "ITMO Widgets MCP laptop bot/2.0.1 (Macintosh; Intel Mac OS X 10_15_7)",
    );
    expect(botUserAgent("agent", "pc", undefined, "Windows")).toBe("ITMO Widgets agent pc bot/1 (Windows NT 10.0; Win64; x64)");
  });

  it("keeps only the characters ITMO.ID's parser accepts", () => {
    expect(botUserAgent("agent", "  my-nas_2   [home]!  ", "", "linux")).toBe(
      "ITMO Widgets agent my-nas_2 [home]! bot/1 (X11; Linux x86_64)",
    );
    expect(botUserAgent("agent", "nas.home", "1", "freebsd")).toBe("ITMO Widgets agent nashome bot/1");
    expect(botUserAgent("MCP", "Ноутбук", "1")).toBe("ITMO Widgets MCP bot/1");
    expect(botUserAgent("agent", "a:\tb /c", "1")).toBe("ITMO Widgets agent a:b c bot/1");
  });

  it("cuts the name to 50 characters and rejects odd versions", () => {
    const label = botUserAgent("agent", `${"x".repeat(10)} ${"y".repeat(60)}`, "3.1", "linux");
    expect(label.split("/")[0]).toHaveLength(50);
    expect(label.split("/")[0]).toMatch(/^ITMO Widgets agent xxxxxxxxxx yyy+ bot$/);
    for (const version of ["1.2.3.4", "v1", "1.", "1-beta", " "]) {
      expect(botUserAgent("agent", undefined, version)).toBe("ITMO Widgets agent bot/1");
    }
    expect(botUserAgent("agent", undefined, " 10.20.30 ")).toBe("ITMO Widgets agent bot/10.20.30");
  });

  it("looks like desktop Chrome, Linux by default", () => {
    const linux = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";
    expect(browserUserAgent("linux")).toBe(linux);
    expect(browserUserAgent()).toBe(linux);
    expect(browserUserAgent("macos")).toContain("(Macintosh; Intel Mac OS X 10_15_7)");
    expect(browserUserAgent("windows")).toContain("(Windows NT 10.0; Win64; x64)");
  });
});

describe("ITMO_BROWSER_UA", () => {
  it("is on by default and switches env sign-ins to the honest label", async () => {
    const { signInUserAgent } = await import("../../src/app.js");
    const { loadConfig } = await import("../../src/config.js");

    expect(signInUserAgent(loadConfig({}))).toMatch(/^Mozilla\/5\.0 .* Chrome\/155/);
    expect(signInUserAgent(loadConfig({ ITMO_BROWSER_UA: "false" }))).toMatch(/^ITMO Widgets MCP bot\/\d+\.\d+\.\d+/);
  });
});
