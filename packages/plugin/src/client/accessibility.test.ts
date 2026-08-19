import { describe, expect, it } from "vitest";
import { tabAfterKey, tabStopForGroup } from "./accessibility.ts";

describe("keyboard tab navigation", () => {
  const tabs = ["overview", "plans", "archive"] as const;

  it("wraps arrow navigation in both directions", () => {
    expect(tabAfterKey(tabs, "archive", "ArrowRight")).toBe("overview");
    expect(tabAfterKey(tabs, "overview", "ArrowLeft")).toBe("archive");
  });

  it("supports Home and End without consuming unrelated keys", () => {
    expect(tabAfterKey(tabs, "plans", "Home")).toBe("overview");
    expect(tabAfterKey(tabs, "plans", "End")).toBe("archive");
    expect(tabAfterKey(tabs, "plans", "Enter")).toBeUndefined();
  });

  it("gives every tab group one keyboard stop", () => {
    expect(tabStopForGroup(tabs, "plans")).toBe("plans");
    expect(tabStopForGroup(tabs, "missing")).toBe("overview");
    expect(tabStopForGroup([], "missing")).toBeUndefined();
  });
});
