import { describe, expect, it } from "vitest";
import type { TeamPlanItem } from "./contracts.ts";
import { summarizeTeamPlanItems } from "./team-plan.ts";

const baseItem = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  planId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  position: 0,
  peerNodeId: `node_${"a".repeat(43)}`,
  peerDisplayName: "Bob",
  objective: "Do the work",
  acceptanceCriteria: [],
  attachmentRefs: [],
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
} satisfies Omit<TeamPlanItem, "status">;

describe("team plan rollups", () => {
  it("classifies every item exactly once across dispatch and execution", () => {
    const statuses = [
      "QUEUED",
      "WAITING_HUMAN",
      "RUNNING",
      "COMPLETED",
      "REJECTED",
      "CANCELED",
    ] as const;
    const items: TeamPlanItem[] = [
      { ...baseItem, id: crypto.randomUUID(), status: "DRAFT" },
      { ...baseItem, id: crypto.randomUUID(), status: "FAILED" },
      ...statuses.map(
        (status, index): TeamPlanItem => ({
          ...baseItem,
          id: crypto.randomUUID(),
          position: index + 2,
          status: "DISPATCHED",
          delegationId: crypto.randomUUID(),
          delegation: {
            status,
            deliveryStatus: "STORED_BY_RELAY",
            outputs: [],
            updatedAt: "2026-08-20T00:01:00.000Z",
          },
        }),
      ),
    ];

    const rollup = summarizeTeamPlanItems(items);
    expect(rollup).toEqual({
      total: 8,
      pendingDispatch: 1,
      dispatchFailed: 1,
      queued: 1,
      waitingHuman: 1,
      running: 1,
      completed: 1,
      failed: 1,
      canceled: 1,
    });
    expect(
      Object.entries(rollup)
        .filter(([key]) => key !== "total")
        .reduce((total, [, count]) => total + count, 0),
    ).toBe(rollup.total);
  });
});
