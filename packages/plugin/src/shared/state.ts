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

export interface SquadAttentionSummary {
  revision: number;
  setupRequired: boolean;
  waitingHuman: number;
  failedOutgoing: number;
  pendingJoinRequests: number;
  draftPlans: number;
  updateAvailable: boolean;
  total: number;
}

export type ConnectionStatus =
  | "NOT_CONFIGURED"
  | "CHECKING"
  | "CONNECTED"
  | "SERVING"
  | "READY"
  | "UNVERIFIED"
  | "UNREACHABLE";

export interface SquadConnectionDiagnostics {
  checkedAt?: string;
  relay: {
    status: ConnectionStatus;
    configured: boolean;
    serving: boolean;
    url?: string;
    lastSuccessfulAt?: string;
    lastError?: string;
    eventStream: "CONNECTED" | "POLLING" | "DISABLED";
    remoteVersion?: string;
    protocolVersions?: number[];
  };
  direct: {
    status: ConnectionStatus;
    serving: boolean;
    publicUrl?: string;
    lastReceivedAt?: string;
    lastError?: string;
  };
  queue: {
    pending: number;
    retrying: number;
    nextAttemptAt?: string;
    lastError?: string;
  };
}

export type SquadNodeRole =
  | "UNCONFIGURED"
  | "MEMBER_NODE"
  | "RELAY_HOST"
  | "HYBRID";

export interface SquadNodeRoleSource {
  relay: {
    configured: boolean;
    serving: boolean;
  };
  direct: {
    serving: boolean;
  };
}

/**
 * Relay hosting and member connectivity are independent capabilities. Keeping
 * the distinction explicit prevents a dedicated Relay from looking like an
 * unconfigured member Node in the WebUI.
 */
export function squadNodeRole(source: SquadNodeRoleSource): SquadNodeRole {
  const memberConnected = source.relay.configured || source.direct.serving;
  if (source.relay.serving) {
    return memberConnected ? "HYBRID" : "RELAY_HOST";
  }
  return memberConnected ? "MEMBER_NODE" : "UNCONFIGURED";
}

export function isRelayHostOnly(source: SquadNodeRoleSource): boolean {
  return squadNodeRole(source) === "RELAY_HOST";
}

export interface RelayOperationsSnapshot {
  capturedAt: string;
  startedAt: string;
  nodes: {
    active: number;
    disabled: number;
  };
  mailbox: {
    pending: number;
    connectedNodes: number;
    liveConnections: number;
    maxItemsPerNode: number;
    oldestPendingAt?: string;
  };
  organizations: {
    active: number;
    dissolved: number;
    pendingJoinRequests: number;
    activeInvitations: number;
  };
  enrollmentInvitations: {
    active: number;
  };
  limits: {
    maxRequestsPerMinute: number;
  };
}

export interface SquadAttentionSource {
  revision: number;
  setupRequired: boolean;
  delegations: readonly {
    direction: "INCOMING" | "OUTGOING";
    status: DelegationStatus;
    deliveryStatus: string;
    archivedAt?: string;
  }[];
  plans: readonly { status: string; archivedAt?: string }[];
  organizations: readonly {
    role?: string;
    membershipStatus: string;
    pendingJoinRequests: readonly unknown[];
  }[];
  updateAvailable: boolean;
}

/**
 * Reduces local state to the items that should pull the owner's attention.
 * Terminal failures stay visible until the user can explicitly archive them.
 */
export function summarizeAttention(
  source: SquadAttentionSource,
): SquadAttentionSummary {
  const waitingHuman = source.delegations.filter(
    (item) =>
      item.archivedAt === undefined &&
      item.direction === "INCOMING" &&
      item.status === "WAITING_HUMAN",
  ).length;
  const failedOutgoing = source.delegations.filter(
    (item) =>
      item.archivedAt === undefined &&
      item.direction === "OUTGOING" &&
      (item.status === "FAILED" || item.deliveryStatus === "DELIVERY_EXPIRED"),
  ).length;
  const pendingJoinRequests = source.organizations
    .filter(
      (organization) =>
        organization.membershipStatus === "ACTIVE" &&
        (organization.role === "OWNER" || organization.role === "ADMIN"),
    )
    .reduce(
      (count, organization) => count + organization.pendingJoinRequests.length,
      0,
    );
  const draftPlans = source.plans.filter(
    (plan) =>
      plan.archivedAt === undefined &&
      ["DRAFT", "PARTIAL"].includes(plan.status),
  ).length;
  return {
    revision: source.revision,
    setupRequired: source.setupRequired,
    waitingHuman,
    failedOutgoing,
    pendingJoinRequests,
    draftPlans,
    updateAvailable: source.updateAvailable,
    total:
      waitingHuman +
      failedOutgoing +
      pendingJoinRequests +
      draftPlans +
      (source.updateAvailable ? 1 : 0),
  };
}

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
