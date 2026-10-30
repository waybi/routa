"use client";

/** Four numbers on top of the overview; each is a toggle that narrows the page to one state. */

import { StatusDot, type Tone } from "@/client/components/ui/badge";
import { useTranslation } from "@/i18n";
import type { OverviewStatus, StatusBarCounts } from "./kanban-overview-status-rules";

const ITEMS: ReadonlyArray<{ status: OverviewStatus; count: Exclude<keyof StatusBarCounts, "resolvedAwaitingCleanup">; tone: Tone; pulse?: boolean }> = [
  { status: "running", count: "running", tone: "attention", pulse: true },
  { status: "queued", count: "queued", tone: "info" },
  { status: "attention", count: "attention", tone: "danger" },
  { status: "done", count: "doneToday", tone: "success" },
];

export function KanbanOverviewStatusBar({
  counts,
  active,
  onToggle,
}: {
  counts: StatusBarCounts;
  active: OverviewStatus | null;
  onToggle: (status: OverviewStatus) => void;
}) {
  const { t } = useTranslation();
  const copy = t.kanbanOverview;
  const labels: Record<OverviewStatus, string> = {
    running: copy.statusRunning,
    queued: copy.statusQueued,
    attention: copy.statusNeedsYou,
    done: copy.statusDoneToday,
  };
  return (
    <div className="grid grid-cols-4 gap-2 px-1 pb-2" role="group" aria-label={copy.statusBarLabel} data-testid="kanban-overview-status-bar">
      {ITEMS.map((item) => (
        <button
          key={item.status}
          type="button"
          aria-pressed={active === item.status}
          onClick={() => onToggle(item.status)}
          title={item.status === "queued" && counts.resolvedAwaitingCleanup > 0
            ? copy.queuedResolvedHint.replace("{count}", String(counts.resolvedAwaitingCleanup))
            : undefined}
          data-testid={`kanban-overview-status-${item.status}`}
          className={`flex min-w-0 items-center gap-2 rounded-md border px-3 py-2.5 text-left transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-accent ${active === item.status
            ? "border-accent bg-accent-subtle"
            : "border-default bg-surface hover:bg-hover"}`}
        >
          <span className="text-[20px] font-semibold text-primary" data-testid={`kanban-overview-status-${item.status}-count`}>{counts[item.count]}</span>
          <StatusDot tone={item.tone} pulse={item.pulse} label={labels[item.status]} className="text-[12px]" />
        </button>
      ))}
    </div>
  );
}
