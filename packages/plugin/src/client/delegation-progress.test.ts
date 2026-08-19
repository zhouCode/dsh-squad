import { describe, expect, it } from "vitest";
import { delegationProgress } from "./delegation-progress.ts";

const base = {
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T00:01:00.000Z",
  openTodoCount: 0,
};

describe("delegationProgress", () => {
  it("makes an offline outgoing delivery and automatic retry explicit", () => {
    const progress = delegationProgress({
      ...base,
      direction: "OUTGOING",
      status: "QUEUED",
      deliveryStatus: "WAITING_FOR_PEER",
    });
    expect(progress.nextAction).toBe("AUTOMATIC_RETRY");
    expect(progress.stages.map(({ state }) => state)).toEqual([
      "DONE",
      "CURRENT",
      "PENDING",
      "PENDING",
    ]);
  });

  it("shows when the receiving owner must decide", () => {
    const progress = delegationProgress({
      ...base,
      direction: "INCOMING",
      status: "WAITING_HUMAN",
      deliveryStatus: "RECEIVED_LOCAL",
      openTodoCount: 1,
    });
    expect(progress.nextAction).toBe("LOCAL_DECISION");
    expect(progress.stages[1]?.state).toBe("DONE");
    expect(progress.stages[2]?.state).toBe("CURRENT");
  });

  it("does not imply execution before a Relay-stored task reaches its peer", () => {
    const progress = delegationProgress({
      ...base,
      direction: "OUTGOING",
      status: "QUEUED",
      deliveryStatus: "STORED_BY_RELAY",
    });
    expect(progress.nextAction).toBe("PEER_RECEIVE");
    expect(progress.stages.map(({ state }) => state)).toEqual([
      "DONE",
      "DONE",
      "PENDING",
      "PENDING",
    ]);
  });

  it("marks a failed terminal result without suggesting more work", () => {
    const progress = delegationProgress({
      ...base,
      direction: "OUTGOING",
      status: "FAILED",
      deliveryStatus: "RECEIVED_BY_NODE",
      completedAt: "2026-08-20T00:02:00.000Z",
    });
    expect(progress.nextAction).toBe("STOPPED");
    expect(progress.stages.at(-1)).toEqual({
      id: "RESULT",
      state: "ERROR",
      timestamp: "2026-08-20T00:02:00.000Z",
    });
  });
});
