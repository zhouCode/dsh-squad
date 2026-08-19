export type DelegationProgressState = "DONE" | "CURRENT" | "PENDING" | "ERROR";

export type DelegationProgressStageId =
  | "CREATED"
  | "DELIVERY"
  | "EXECUTION"
  | "RESULT";

export type DelegationNextAction =
  | "LOCAL_DECISION"
  | "LOCAL_EXECUTION"
  | "AUTOMATIC_RETRY"
  | "PEER_RECEIVE"
  | "PEER_EXECUTION"
  | "COMPLETE"
  | "STOPPED";

export interface DelegationProgressInput {
  direction: "INCOMING" | "OUTGOING";
  status: string;
  deliveryStatus: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  openTodoCount: number;
}

export interface DelegationProgressStage {
  id: DelegationProgressStageId;
  state: DelegationProgressState;
  timestamp?: string;
}

export interface DelegationProgress {
  stages: DelegationProgressStage[];
  nextAction: DelegationNextAction;
}

const terminalStatuses = new Set([
  "COMPLETED",
  "REJECTED",
  "FAILED",
  "CANCELED",
]);

function resultState(status: string): DelegationProgressState {
  if (status === "COMPLETED") return "DONE";
  if (terminalStatuses.has(status)) return "ERROR";
  return "PENDING";
}

export function delegationProgress(
  input: DelegationProgressInput,
): DelegationProgress {
  const terminal = terminalStatuses.has(input.status);
  const deliveryError = input.deliveryStatus === "DELIVERY_EXPIRED";
  const deliveryWaiting = ["QUEUED_LOCAL", "WAITING_FOR_PEER"].includes(
    input.deliveryStatus,
  );
  const deliveryState: DelegationProgressState = deliveryError
    ? "ERROR"
    : input.direction === "INCOMING" || !deliveryWaiting
      ? "DONE"
      : "CURRENT";
  const executionState: DelegationProgressState = terminal
    ? input.status === "COMPLETED"
      ? "DONE"
      : "ERROR"
    : input.direction === "OUTGOING" &&
        (deliveryWaiting || input.deliveryStatus === "STORED_BY_RELAY")
      ? "PENDING"
      : "CURRENT";

  let nextAction: DelegationNextAction;
  if (input.status === "COMPLETED") {
    nextAction = "COMPLETE";
  } else if (terminal || deliveryError) {
    nextAction = "STOPPED";
  } else if (input.direction === "INCOMING") {
    nextAction =
      input.status === "WAITING_HUMAN" || input.openTodoCount > 0
        ? "LOCAL_DECISION"
        : "LOCAL_EXECUTION";
  } else if (deliveryWaiting) {
    nextAction = "AUTOMATIC_RETRY";
  } else if (input.deliveryStatus === "STORED_BY_RELAY") {
    nextAction = "PEER_RECEIVE";
  } else {
    nextAction = "PEER_EXECUTION";
  }

  return {
    stages: [
      { id: "CREATED", state: "DONE", timestamp: input.createdAt },
      {
        id: "DELIVERY",
        state: deliveryState,
        ...(deliveryState === "CURRENT" ? {} : { timestamp: input.updatedAt }),
      },
      {
        id: "EXECUTION",
        state: executionState,
        ...(executionState === "CURRENT" ? { timestamp: input.updatedAt } : {}),
      },
      {
        id: "RESULT",
        state: resultState(input.status),
        ...(input.completedAt === undefined
          ? {}
          : { timestamp: input.completedAt }),
      },
    ],
    nextAction,
  };
}
