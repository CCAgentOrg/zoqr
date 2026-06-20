import { describe, expect, test } from "bun:test";
import { expand, parseRange, parseSlug } from "./range.ts";

describe("parseSlug", () => {
  test("single slug passes through", () => {
    expect(parseSlug("front-desk")).toEqual({ kind: "single", slug: "front-desk" });
  });

  test("trims and lowercases single", () => {
    expect(parseSlug("  Front-Desk  ")).toEqual({ kind: "single", slug: "front-desk" });
  });

  test("numeric range", () => {
    expect(parseSlug("table-1-12")).toEqual({
      kind: "range", prefix: "table", suffixKind: "numeric", start: 1, end: 12, pad: 1,
    });
  });

  test("numeric range with zero-pad", () => {
    expect(parseSlug("shelf-01-09")).toEqual({
      kind: "range", prefix: "shelf", suffixKind: "numeric", start: 1, end: 9, pad: 2,
    });
  });

  test("alpha range", () => {
    expect(parseSlug("locker-a-d")).toEqual({
      kind: "range", prefix: "locker", suffixKind: "alpha", start: 97, end: 100, pad: 1,
    });
  });
});

describe("expand", () => {
  test("single", () => {
    expect(expand({ kind: "single", slug: "x" })).toEqual(["x"]);
  });
  test("numeric range, no pad", () => {
    const p = parseSlug("table-1-3")!;
    expect(expand(p)).toEqual(["table-1", "table-2", "table-3"]);
  });
  test("numeric range, zero-pad", () => {
    const p = parseSlug("shelf-01-03")!;
    expect(expand(p)).toEqual(["shelf-01", "shelf-02", "shelf-03"]);
  });
  test("alpha range", () => {
    const p = parseSlug("locker-a-c")!;
    expect(expand(p)).toEqual(["locker-a", "locker-b", "locker-c"]);
  });
  test("respects max", () => {
    const p = parseSlug("t-1-1000")!;
    expect(expand(p, 50)).toHaveLength(50);
  });
});

describe("parseRange (with taken set)", () => {
  test("filters out conflicts", () => {
    const taken = new Set(["table-1", "table-2"]);
    const result = parseRange("table-1-5", taken).map((r) => r.slug);
    expect(result).toEqual(["table-3", "table-4", "table-5"]);
  });

  test("empty input", () => {
    expect(parseRange("", new Set())).toEqual([]);
    expect(parseRange("   ", new Set())).toEqual([]);
  });

  test("single slug passthrough", () => {
    const taken = new Set(["front-desk"]);
    const result = parseRange("front-desk", taken);
    expect(result).toEqual([]);
  });
});
