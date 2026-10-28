"use client";

/**
 * Progress line of an in-progress card: a 5-cell Backlog→Todo→Dev→Review→Done
 * pipeline, "Dev 3/5", the current specialist, how long the run has been
 * running and its step number. Derived from the card's lane sessions only.
 */

import { useTranslation } from "@/i18n";
import type { TaskInfo } from "../types";
import { formatSpan } from "./kanban-overview-format";
import { laneProgress, PIPELINE_STEPS } from "./kanban-overview-status-rules";

function cellClass(index: number, step: number, failed: boolean): string {
  const base = "h-1 w-4 rounded-[2px]";
  const position = index + 1;
  if (position < step) return `${base} bg-accent/40`;
  if (position === step) {
    return failed
      ? `${base} bg-danger`
      : `${base} bg-[color:var(--lane-dev)] motion-safe:animate-pulse`;
  }
  return `${base} bg-default`;
}

/** The five pipeline cells alone (aria-hidden; the text next to them carries the meaning). */
export function PipelineCells({ step, failed }: { step: number; failed: boolean }) {
  return (
    <span className="flex shrink-0 gap-0.5" aria-hidden="true">
      {PIPELINE_STEPS.map((stage, index) => (
        <span key={stage} className={cellClass(index, step, failed)} title={stage} data-cell={index + 1 < step ? "past" : index + 1 === step ? "current" : "future"} />
      ))}
    </span>
  );
}

export function KanbanOverviewProgress({ task, laneLabel, now }: { task: TaskInfo; laneLabel: string; now: number }) {
  const { t } = useTranslation();
  const copy = t.kanbanOverview;
  const progress = laneProgress(task, now);
  const label = copy.laneStepLabel.replace("{lane}", laneLabel).replace("{step}", String(progress.step));
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-secondary" data-testid="kanban-overview-progress" data-failed={progress.failed ? "true" : "false"}>
      <PipelineCells step={progress.step} failed={progress.failed} />
      <span className={`shrink-0 font-semibold ${progress.failed ? "text-danger" : "text-primary"}`}>{label}</span>
      {progress.specialistName && <span className="truncate">· {progress.specialistName}</span>}
      {progress.runningMs !== null && <span className="shrink-0">· {copy.ranFor.replace("{time}", formatSpan(progress.runningMs, copy))}</span>}
      {progress.stepNumber !== null && <span className="shrink-0">· {copy.stepNumber.replace("{step}", String(progress.stepNumber))}</span>}
    </div>
  );
}
