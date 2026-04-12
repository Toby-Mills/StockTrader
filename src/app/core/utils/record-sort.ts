type SortDirection = 'asc' | 'desc';

interface DatedRecord {
  date: unknown;
  createdAt?: unknown;
}

export function compareByDateAndCreatedAt<T extends DatedRecord>(
  left: T,
  right: T,
  direction: SortDirection = 'desc'
): number {
  const dateDelta = toTimestamp(left.date) - toTimestamp(right.date);
  if (dateDelta !== 0) {
    return direction === 'asc' ? dateDelta : -dateDelta;
  }

  const createdAtLeft = toTimestamp(left.createdAt, Number.NaN);
  const createdAtRight = toTimestamp(right.createdAt, Number.NaN);
  const bothHaveCreatedAt = Number.isFinite(createdAtLeft) && Number.isFinite(createdAtRight);

  if (bothHaveCreatedAt && createdAtLeft !== createdAtRight) {
    return direction === 'asc'
      ? createdAtLeft - createdAtRight
      : createdAtRight - createdAtLeft;
  }

  return 0;
}

export function sortByDateAndCreatedAt<T extends DatedRecord>(
  records: T[],
  direction: SortDirection = 'desc'
): T[] {
  return records
    .map((record, originalIndex) => ({ record, originalIndex }))
    .sort((left, right) => {
      const delta = compareByDateAndCreatedAt(left.record, right.record, direction);
      if (delta !== 0) {
        return delta;
      }

      return left.originalIndex - right.originalIndex;
    })
    .map(entry => entry.record);
}

function toTimestamp(value: unknown, fallback = 0): number {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? fallback : value.getTime();
  }

  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    const candidate = (value as { toDate?: () => unknown }).toDate?.();
    if (candidate instanceof Date && !Number.isNaN(candidate.getTime())) {
      return candidate.getTime();
    }
    return fallback;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed.getTime();
  }

  return fallback;
}