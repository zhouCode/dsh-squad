import { describe, expect, it } from "vitest";
import { isRelayHostOnly, squadNodeRole } from "./state.ts";

describe("Squad Node roles", () => {
  it("distinguishes a dedicated Relay host from an unconfigured member", () => {
    const relayHost = {
      relay: { serving: true, configured: false },
      direct: { serving: false },
    };
    expect(squadNodeRole(relayHost)).toBe("RELAY_HOST");
    expect(isRelayHostOnly(relayHost)).toBe(true);
    expect(
      squadNodeRole({
        relay: { serving: false, configured: false },
        direct: { serving: false },
      }),
    ).toBe("UNCONFIGURED");
  });

  it("reports member and hybrid capabilities independently of Relay hosting", () => {
    expect(
      squadNodeRole({
        relay: { serving: false, configured: true },
        direct: { serving: false },
      }),
    ).toBe("MEMBER_NODE");
    expect(
      squadNodeRole({
        relay: { serving: true, configured: true },
        direct: { serving: false },
      }),
    ).toBe("HYBRID");
    expect(
      squadNodeRole({
        relay: { serving: true, configured: false },
        direct: { serving: true },
      }),
    ).toBe("HYBRID");
  });
});
