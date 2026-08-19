export type LocalEventStreamState = "CONNECTING" | "LIVE" | "RECONNECTING";

export type LocalSyncHealth = LocalEventStreamState | "STALE";

export function localSyncHealth(input: {
  eventStream: LocalEventStreamState;
  lastRefreshedAt?: number;
  now: number;
  staleAfterMs?: number;
}): LocalSyncHealth {
  if (input.eventStream === "LIVE") return "LIVE";
  if (
    input.lastRefreshedAt !== undefined &&
    input.now - input.lastRefreshedAt > (input.staleAfterMs ?? 30_000)
  ) {
    return "STALE";
  }
  return input.eventStream;
}
