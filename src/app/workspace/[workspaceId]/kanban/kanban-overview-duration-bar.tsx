"use client";

/** Five-part AI-time bar (prepare / build / check / finish / stuck) with a title per part. */

import { useTranslation } from "@/i18n";
import { DURATION_BUCKET_ORDER, type DurationBuckets, type DurationBucketKey } from "./kanban-overview-duration";
import { formatSpan } from "./kanban-overview-format";

const COLOR: Record<DurationBucketKey, string> = {
  prepare: "bg-[color:var(--lane-todo)]",
  build: "bg-[color:var(--lane-dev)]",
  check: "bg-[color:var(--lane-review)]",
  finish: "bg-[color:var(--lane-done)]",
  stuck: "bg-[repeating-linear-gradient(45deg,var(--lane-blocked)_0_3px,transparent_3px_6px)]",
};

export function useBucketNames(): Record<DurationBucketKey, string> {
  const { t } = useTranslation();
  const copy = t.kanbanOverview;
  return { prepare: copy.bucketPrepare, build: copy.bucketBuild, check: copy.bucketCheck, finish: copy.bucketFinish, stuck: copy.bucketStuck };
}

export function KanbanOverviewDurationBar({ buckets, className = "" }: { buckets: DurationBuckets; className?: string }) {
  const { t } = useTranslation();
  const copy = t.kanbanOverview;
  const names = useBucketNames();
  const total = DURATION_BUCKET_ORDER.reduce((sum, key) => sum + buckets[key], 0);
  return (
    <span className={`flex h-1.5 overflow-hidden rounded-[2px] bg-default ${className}`} data-testid="kanban-overview-duration-bar">
      {total > 0 && DURATION_BUCKET_ORDER.map((key) => (buckets[key] > 0 ? (
        <span
          key={key}
          className={`h-full ${COLOR[key]}`}
          style={{ width: `${(buckets[key] / total) * 100}%` }}
          title={copy.bucketTitle.replace("{name}", names[key]).replace("{time}", formatSpan(buckets[key], copy))}
          data-bucket={key}
        />
      ) : null))}
    </span>
  );
}
