export const DEFAULT_PAGE_SIZE = 25;

export interface PageSlice<T> {
  items: T[];
  page: number;
  pageCount: number;
  start: number;
  end: number;
  total: number;
}

export function pageContaining(
  index: number,
  pageSize = DEFAULT_PAGE_SIZE,
): number {
  if (!Number.isInteger(index) || index < 0) return 1;
  return Math.floor(index / pageSize) + 1;
}

export function paginate<T>(
  items: readonly T[],
  requestedPage: number,
  pageSize = DEFAULT_PAGE_SIZE,
): PageSlice<T> {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error("pageSize must be a positive integer");
  }
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const normalized = Number.isFinite(requestedPage)
    ? Math.trunc(requestedPage)
    : 1;
  const page = Math.min(pageCount, Math.max(1, normalized));
  const offset = (page - 1) * pageSize;
  const pageItems = items.slice(offset, offset + pageSize);
  return {
    items: pageItems,
    page,
    pageCount,
    start: total === 0 ? 0 : offset + 1,
    end: offset + pageItems.length,
    total,
  };
}
