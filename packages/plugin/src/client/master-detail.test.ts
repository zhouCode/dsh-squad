import { describe, expect, it } from "vitest";
import { masterDetailClassName, masterDetailPane } from "./master-detail.ts";

describe("responsive master-detail navigation", () => {
  it("starts on the list until a record is explicitly selected", () => {
    expect(masterDetailPane(undefined)).toBe("LIST");
    expect(masterDetailClassName(undefined)).toBe("squad-content");
  });

  it("opens detail for delegation, plan, and archive keys", () => {
    for (const key of ["delegation-1", "plan-1", "delegation:archived-1"]) {
      expect(masterDetailPane(key)).toBe("DETAIL");
      expect(masterDetailClassName(key)).toBe(
        "squad-content squad-detail-open",
      );
    }
  });
});
