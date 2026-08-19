import type { TeamPlan, UpdateTeamPlanInput } from "../shared/contracts.ts";
import {
  parseAttachmentDrafts,
  type AttachmentDraft,
  type AttachmentDraftError,
} from "./human-input.ts";

export interface TeamPlanDraftItem {
  key: string;
  id?: string;
  to: string;
  objective: string;
  context: string;
  acceptanceCriteria: string;
  attachments: AttachmentDraft[];
}

export interface TeamPlanDraft {
  title: string;
  sourceSummary: string;
  items: TeamPlanDraftItem[];
}

export type TeamPlanDraftResult =
  | { ok: true; input: UpdateTeamPlanInput }
  | {
      ok: false;
      item: number;
      attachmentRow?: number;
      error: AttachmentDraftError;
    };

export function draftFromTeamPlan(plan: TeamPlan): TeamPlanDraft {
  return {
    title: plan.title,
    sourceSummary: plan.sourceSummary ?? "",
    items: plan.items.map((item) => ({
      key: item.id,
      id: item.id,
      to: item.membershipId ?? item.peerNodeId,
      objective: item.objective,
      context: item.context ?? "",
      acceptanceCriteria: item.acceptanceCriteria.join("\n"),
      attachments: item.attachmentRefs.map((attachment, index) => ({
        id: `${item.id}-attachment-${index + 1}`,
        url: attachment.url,
        sha256: attachment.sha256,
        size: String(attachment.size),
        name: attachment.name,
      })),
    })),
  };
}

export function buildTeamPlanUpdate(
  draft: TeamPlanDraft,
  revision: number,
): TeamPlanDraftResult {
  const items: UpdateTeamPlanInput["items"] = [];
  for (const [index, item] of draft.items.entries()) {
    const parsed = parseAttachmentDrafts(item.attachments);
    if (!parsed.ok) {
      return {
        ok: false,
        item: index + 1,
        ...(parsed.row === undefined ? {} : { attachmentRow: parsed.row }),
        error: parsed.error,
      };
    }
    const context = item.context.trim();
    items.push({
      ...(item.id === undefined ? {} : { id: item.id }),
      to: item.to.trim(),
      objective: item.objective.trim(),
      ...(context ? { context } : {}),
      acceptanceCriteria: item.acceptanceCriteria
        .split("\n")
        .map((criterion) => criterion.trim())
        .filter(Boolean),
      attachmentRefs: parsed.refs,
    });
  }
  const sourceSummary = draft.sourceSummary.trim();
  return {
    ok: true,
    input: {
      revision,
      title: draft.title.trim(),
      ...(sourceSummary ? { sourceSummary } : {}),
      items,
    },
  };
}
