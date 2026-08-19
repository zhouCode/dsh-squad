import { describe, expect, it } from "vitest";
import type { TeamPlan } from "../shared/contracts.ts";
import {
  buildTeamPlanUpdate,
  draftFromTeamPlan,
  type TeamPlanDraft,
} from "./team-plan.ts";

const plan: TeamPlan = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  title: "Release plan",
  sourceSummary: "Meeting decisions",
  status: "DRAFT",
  revision: 4,
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
  rollup: {
    total: 1,
    pendingDispatch: 1,
    dispatchFailed: 0,
    queued: 0,
    waitingHuman: 0,
    running: 0,
    completed: 0,
    failed: 0,
    canceled: 0,
  },
  items: [
    {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      planId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      position: 0,
      peerNodeId: `node_${"a".repeat(43)}`,
      peerDisplayName: "Bob",
      objective: "Draft notes",
      acceptanceCriteria: ["Markdown", "No secrets"],
      attachmentRefs: [
        {
          url: "https://example.test/notes.txt",
          sha256: "a".repeat(64),
          size: 42,
          name: "notes.txt",
        },
      ],
      status: "DRAFT",
      createdAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-20T00:00:00.000Z",
    },
  ],
};

describe("team plan editor", () => {
  it("round-trips stable item IDs, criteria, and verified attachments", () => {
    const draft = draftFromTeamPlan(plan);
    const result = buildTeamPlanUpdate(draft, plan.revision);
    expect(result).toEqual({
      ok: true,
      input: {
        revision: 4,
        title: "Release plan",
        sourceSummary: "Meeting decisions",
        items: [
          {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            to: `node_${"a".repeat(43)}`,
            objective: "Draft notes",
            acceptanceCriteria: ["Markdown", "No secrets"],
            attachmentRefs: [
              {
                url: "https://example.test/notes.txt",
                sha256: "a".repeat(64),
                size: 42,
                name: "notes.txt",
              },
            ],
          },
        ],
      },
    });
  });

  it("identifies the plan item containing an invalid attachment", () => {
    const draft: TeamPlanDraft = {
      title: "Plan",
      sourceSummary: "",
      items: [
        {
          key: "new-1",
          to: "Bob",
          objective: "Draft",
          context: "",
          acceptanceCriteria: "",
          attachments: [
            {
              id: "attachment-1",
              url: "http://example.test/input.txt",
              sha256: "a".repeat(64),
              size: "1",
              name: "input.txt",
            },
          ],
        },
      ],
    };
    expect(buildTeamPlanUpdate(draft, 1)).toEqual({
      ok: false,
      item: 1,
      attachmentRow: 1,
      error: "HTTPS_REQUIRED",
    });
  });
});
