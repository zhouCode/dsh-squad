export const delegationStatuses = [
  "QUEUED",
  "RECEIVED",
  "TRIAGING",
  "RUNNING",
  "WAITING_HUMAN",
  "COMPLETED",
  "REJECTED",
  "FAILED",
  "CANCELED",
] as const;

export type DelegationStatus = (typeof delegationStatuses)[number];
export type TerminalDelegationStatus = Extract<
  DelegationStatus,
  "COMPLETED" | "REJECTED" | "FAILED" | "CANCELED"
>;

const transitions: Readonly<
  Record<DelegationStatus, readonly DelegationStatus[]>
> = {
  QUEUED: ["RECEIVED", "FAILED", "CANCELED"],
  RECEIVED: ["TRIAGING", "CANCELED"],
  TRIAGING: ["RUNNING", "WAITING_HUMAN", "REJECTED", "CANCELED"],
  RUNNING: ["COMPLETED", "WAITING_HUMAN", "FAILED", "CANCELED"],
  WAITING_HUMAN: ["RUNNING", "REJECTED", "FAILED", "CANCELED"],
  COMPLETED: [],
  REJECTED: [],
  FAILED: [],
  CANCELED: [],
};

export function isTerminalStatus(
  status: DelegationStatus,
): status is TerminalDelegationStatus {
  return transitions[status].length === 0;
}

export function canTransition(
  from: DelegationStatus,
  to: DelegationStatus,
): boolean {
  return from === to || transitions[from].includes(to);
}

export function assertTransition(
  from: DelegationStatus,
  to: DelegationStatus,
): void {
  if (!canTransition(from, to)) {
    throw new Error(`invalid delegation transition ${from} -> ${to}`);
  }
}
