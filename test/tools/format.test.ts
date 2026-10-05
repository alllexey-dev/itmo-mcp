import { describe, expect, it } from "vitest";
import { compact, toolError, toolResult } from "../../src/tools/format.js";

describe("compact", () => {
  it("drops null, empty strings, empty arrays and empty objects but keeps false and 0", () => {
    expect(compact({ a: null, b: "", c: [], d: {}, e: [null, { f: null }], g: false, h: 0, i: ["x", ""] })).toEqual({
      g: false,
      h: 0,
      i: ["x"],
    });
  });
});

describe("toolResult", () => {
  it("serializes compact JSON", () => {
    expect(toolResult({ a: 1, b: null })).toEqual({ content: [{ type: "text", text: '{"a":1}' }] });
  });

  it("says when there is no data", () => {
    expect(toolResult([])).toEqual({ content: [{ type: "text", text: "No data." }] });
  });
});

describe("toolError", () => {
  it("prefixes unexpected errors", () => {
    expect(toolError(new TypeError("fetch failed"))).toEqual({
      content: [{ type: "text", text: "Unexpected error: fetch failed" }],
      isError: true,
    });
  });
});
