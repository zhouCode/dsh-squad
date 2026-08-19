import {
  MAX_ATTACHMENT_BYTES,
  type AttachmentRef,
} from "../shared/contracts.ts";

export interface AttachmentDraft {
  id: string;
  url: string;
  sha256: string;
  size: string;
  name: string;
}

export type AttachmentDraftError =
  | "TOO_MANY"
  | "INCOMPLETE"
  | "INVALID_URL"
  | "HTTPS_REQUIRED"
  | "INVALID_SHA256"
  | "INVALID_SIZE"
  | "INVALID_NAME";

export type AttachmentDraftResult =
  | { ok: true; refs: AttachmentRef[] }
  | { ok: false; error: AttachmentDraftError; row?: number };

export function parseAttachmentDrafts(
  drafts: readonly AttachmentDraft[],
): AttachmentDraftResult {
  if (drafts.length > 10) return { ok: false, error: "TOO_MANY" };
  const refs: AttachmentRef[] = [];
  for (const [index, draft] of drafts.entries()) {
    const url = draft.url.trim();
    const sha256 = draft.sha256.trim().toLowerCase();
    const sizeText = draft.size.trim();
    const name = draft.name.trim();
    if (!url || !sha256 || !sizeText || !name) {
      return { ok: false, error: "INCOMPLETE", row: index + 1 };
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return { ok: false, error: "INVALID_URL", row: index + 1 };
    }
    if (parsedUrl.protocol !== "https:") {
      return { ok: false, error: "HTTPS_REQUIRED", row: index + 1 };
    }
    if (!/^[a-f0-9]{64}$/.test(sha256)) {
      return { ok: false, error: "INVALID_SHA256", row: index + 1 };
    }
    if (!/^\d+$/.test(sizeText)) {
      return { ok: false, error: "INVALID_SIZE", row: index + 1 };
    }
    const size = Number(sizeText);
    if (!Number.isSafeInteger(size) || size > MAX_ATTACHMENT_BYTES) {
      return { ok: false, error: "INVALID_SIZE", row: index + 1 };
    }
    if (name.length > 240) {
      return { ok: false, error: "INVALID_NAME", row: index + 1 };
    }
    refs.push({ url: parsedUrl.toString(), sha256, size, name });
  }
  return { ok: true, refs };
}
