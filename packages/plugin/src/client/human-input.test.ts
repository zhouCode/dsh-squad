import { describe, expect, it } from "vitest";
import { parseAttachmentDrafts, type AttachmentDraft } from "./human-input.ts";

function draft(overrides: Partial<AttachmentDraft> = {}): AttachmentDraft {
  return {
    id: "draft-1",
    url: "https://files.example.test/evidence.txt",
    sha256: "A".repeat(64),
    size: "123",
    name: " evidence.txt ",
    ...overrides,
  };
}

describe("structured Human Todo attachments", () => {
  it("normalizes a complete attachment row", () => {
    expect(parseAttachmentDrafts([draft()])).toEqual({
      ok: true,
      refs: [
        {
          url: "https://files.example.test/evidence.txt",
          sha256: "a".repeat(64),
          size: 123,
          name: "evidence.txt",
        },
      ],
    });
  });

  it.each([
    [{ url: "" }, "INCOMPLETE"],
    [{ url: "not a url" }, "INVALID_URL"],
    [{ url: "http://files.example.test/a" }, "HTTPS_REQUIRED"],
    [{ sha256: "abc" }, "INVALID_SHA256"],
    [{ size: "1.2" }, "INVALID_SIZE"],
    [{ size: String(25 * 1024 * 1024 + 1) }, "INVALID_SIZE"],
    [{ name: "x".repeat(241) }, "INVALID_NAME"],
  ])("reports an invalid row (%s)", (overrides, error) => {
    expect(parseAttachmentDrafts([draft(overrides)])).toEqual({
      ok: false,
      error,
      row: 1,
    });
  });
});
