import type { TeamPlanItem, TeamPlanRollup } from "./contracts.ts";

export function summarizeTeamPlanItems(
  items: readonly TeamPlanItem[],
): TeamPlanRollup {
  const rollup: TeamPlanRollup = {
    total: items.length,
    pendingDispatch: 0,
    dispatchFailed: 0,
    queued: 0,
    waitingHuman: 0,
    running: 0,
    completed: 0,
    failed: 0,
    canceled: 0,
  };

  for (const item of items) {
    if (item.delegation !== undefined) {
      switch (item.delegation.status) {
        case "WAITING_HUMAN":
          rollup.waitingHuman += 1;
          break;
        case "RUNNING":
          rollup.running += 1;
          break;
        case "COMPLETED":
          rollup.completed += 1;
          break;
        case "FAILED":
        case "REJECTED":
          rollup.failed += 1;
          break;
        case "CANCELED":
          rollup.canceled += 1;
          break;
        default:
          rollup.queued += 1;
      }
      continue;
    }

    switch (item.status) {
      case "DRAFT":
        rollup.pendingDispatch += 1;
        break;
      case "FAILED":
        rollup.dispatchFailed += 1;
        break;
      case "CANCELED":
        rollup.canceled += 1;
        break;
      case "DISPATCHED":
        // Legacy or temporarily inconsistent rows can lack their delegation.
        // Keep them visible as active instead of incorrectly declaring failure.
        rollup.queued += 1;
        break;
    }
  }

  return rollup;
}
