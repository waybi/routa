/** Small display helpers of the all-projects overview. */

export interface SpanCopy {
  minutesShort: string;
  hoursMinutesShort: string;
}

/** "13 分" under an hour, "2 时 5 分" from an hour on (whole minutes, at least 0). */
export function formatSpan(ms: number, copy: SpanCopy): string {
  const total = Math.max(0, Math.floor(ms / 60_000));
  if (total < 60) return copy.minutesShort.replace("{count}", String(total));
  return copy.hoursMinutesShort
    .replace("{hours}", String(Math.floor(total / 60)))
    .replace("{minutes}", String(total % 60));
}
