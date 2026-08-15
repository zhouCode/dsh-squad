import { describe, expect, it } from "vitest";
import { isPublicAddress } from "./attachments.ts";

describe("attachment network boundary", () => {
  it("rejects local, private, link-local and documentation addresses", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "169.254.1.1",
      "172.16.0.1",
      "192.168.0.1",
      "198.51.100.5",
      "203.0.113.7",
      "::1",
      "fd00::1",
      "fe80::1",
      "2001:db8::1",
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
    expect(isPublicAddress("1.1.1.1")).toBe(true);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
  });
});
