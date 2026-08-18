import { describe, expect, it } from "vitest";
import { compareVersions } from "./updates.ts";

describe("Squad update versions", () => {
  it("orders stable and prerelease semantic versions", () => {
    expect(compareVersions("0.5.0", "0.4.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-rc.2", "1.0.0-rc.10")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0-rc.10")).toBeGreaterThan(0);
    expect(compareVersions("2.1.3", "2.1.3")).toBe(0);
  });

  it("rejects non-semantic release identifiers", () => {
    expect(() => compareVersions("latest", "0.5.0")).toThrow(
      "invalid semantic version",
    );
  });
});
