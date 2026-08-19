import { describe, expect, it } from "vitest";
import { pageContaining, paginate } from "./pagination.ts";

describe("pagination", () => {
  it("returns a bounded slice and human-readable range", () => {
    const page = paginate(
      Array.from({ length: 61 }, (_, index) => index),
      2,
    );
    expect(page).toMatchObject({
      page: 2,
      pageCount: 3,
      start: 26,
      end: 50,
      total: 61,
    });
    expect(page.items).toEqual(
      Array.from({ length: 25 }, (_, index) => index + 25),
    );
  });

  it("clamps stale pages after the underlying list shrinks", () => {
    expect(paginate(["a", "b"], 99, 1)).toEqual({
      items: ["b"],
      page: 2,
      pageCount: 2,
      start: 2,
      end: 2,
      total: 2,
    });
    expect(paginate([], 3)).toMatchObject({ page: 1, start: 0, end: 0 });
  });

  it("locates a selected record without scanning page controls", () => {
    expect(pageContaining(0)).toBe(1);
    expect(pageContaining(24)).toBe(1);
    expect(pageContaining(25)).toBe(2);
    expect(pageContaining(-1)).toBe(1);
  });
});
