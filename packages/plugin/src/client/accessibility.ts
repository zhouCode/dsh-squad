export type TabNavigationKey = "ArrowLeft" | "ArrowRight" | "Home" | "End";

export function tabAfterKey<T>(
  tabs: readonly T[],
  current: T,
  key: string,
): T | undefined {
  if (tabs.length === 0) return undefined;
  if (key === "Home") return tabs[0];
  if (key === "End") return tabs.at(-1);
  if (key !== "ArrowLeft" && key !== "ArrowRight") return undefined;
  const index = tabs.indexOf(current);
  if (index < 0) return tabs[0];
  const offset = key === "ArrowRight" ? 1 : -1;
  return tabs[(index + offset + tabs.length) % tabs.length];
}

export function tabStopForGroup<T>(
  tabs: readonly T[],
  selected: T,
): T | undefined {
  return tabs.includes(selected) ? selected : tabs[0];
}
