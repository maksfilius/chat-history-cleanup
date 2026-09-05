export const DAY_MS = 86_400_000;

/** Days since `ts`. Undefined timestamp means unknown age — callers must fail safe. */
export function daysSince(ts: number | undefined, now = Date.now()): number | undefined {
  if (ts === undefined || Number.isNaN(ts)) return undefined;
  return Math.floor((now - ts) / DAY_MS);
}

/** Short human age for a row: "today", "6d", "3mo", "2y". */
export function formatAge(ts: number | undefined, now = Date.now()): string {
  const d = daysSince(ts, now);
  if (d === undefined) return '?';
  if (d <= 0) return 'today';
  if (d < 30) return `${d}d`;
  if (d < 365) return `${Math.floor(d / 30)}mo`;
  return `${Math.floor(d / 365)}y`;
}
