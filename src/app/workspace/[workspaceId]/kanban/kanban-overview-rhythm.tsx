"use client";

/**
 * Right column of the by-status page: per project the cards finished in the
 * last 7 days, the AI time, a five-part time bar and the median / rework /
 * stuck line. "Stuck" is a toggle that narrows the Done list to stuck cards.
 */

import { buttonClassName } from "@/client/components/ui/button";
import { useTranslation } from "@/i18n";
import { KanbanOverviewDurationBar } from "./kanban-overview-duration-bar";
import { formatSpan } from "./kanban-overview-format";
import { msToHours } from "./kanban-overview-duration";
import type { OverviewRow } from "./kanban-overview-rules";
import { startOfLocalDay, summarizeRhythm, withinDoneWindow } from "./kanban-overview-status-rules";

export interface RhythmColumnProps {
  rows: readonly OverviewRow[];
  now: number;
  project: string | null;
  onPickProject: (workspaceId: string) => void;
  stuckOnly: boolean;
  onToggleStuck: () => void;
}

export function KanbanOverviewRhythm({ rows, now, project, onPickProject, stuckOnly, onToggleStuck }: RhythmColumnProps) {
  const { t } = useTranslation();
  const copy = t.kanbanOverview;
  const dayStarts = Array.from({ length: 7 }, (_, index) => startOfLocalDay(now, 6 - index));
  return (
    <aside className="w-72 shrink-0 rounded-md border border-default bg-surface p-3" data-testid="kanban-overview-rhythm">
      <h3 className="m-0 text-[12px] font-semibold text-primary">{copy.rhythmTitle}</h3>
      <p className="m-0 mb-2 mt-0.5 text-[10px] text-secondary">{copy.rhythmHint}</p>
      <div className="space-y-3">
        {rows.map((row) => {
          const summary = summarizeRhythm(row.tasks.filter((task) => withinDoneWindow(task, now)), now);
          const max = Math.max(1, ...summary.perDay);
          return (
            <section key={row.workspaceId} data-testid="kanban-overview-rhythm-project" data-workspace-id={row.workspaceId} aria-current={project === row.workspaceId ? "true" : undefined}>
              <div className="flex items-baseline justify-between gap-2">
                <button
                  type="button"
                  onClick={() => onPickProject(row.workspaceId)}
                  aria-pressed={project === row.workspaceId}
                  className={`min-w-0 truncate rounded text-left text-[12px] font-semibold ${project === row.workspaceId ? "text-accent" : "text-primary hover:text-accent"}`}
                  data-testid="kanban-overview-rhythm-name"
                >
                  {row.title}
                </button>
                <span className="shrink-0 font-mono text-[11px] text-secondary" data-testid="kanban-overview-rhythm-stat">
                  {copy.rhythmProjectStat.replace("{count}", String(summary.count)).replace("{hours}", String(msToHours(summary.totalMs)))}
                </span>
              </div>
              <div className="mt-1 flex h-8 items-end gap-1" aria-hidden="true">
                {summary.perDay.map((value, index) => (
                  <span
                    key={dayStarts[index]}
                    className="flex-1 rounded-[2px] bg-accent/60"
                    style={{ height: `${value === 0 ? 0 : Math.max(10, (value / max) * 100)}%` }}
                    title={copy.barTitle.replace("{day}", `${new Date(dayStarts[index]).getMonth() + 1}-${new Date(dayStarts[index]).getDate()}`).replace("{count}", String(value))}
                    data-testid="kanban-overview-rhythm-day"
                    data-count={value}
                  />
                ))}
              </div>
              <div className="mt-0.5 flex gap-1 text-[10px] text-secondary" aria-hidden="true">
                {dayStarts.map((start) => <span key={start} className="flex-1 text-center">{new Date(start).getDate()}</span>)}
              </div>
              <KanbanOverviewDurationBar buckets={summary.buckets} className="mt-1" />
              <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11px] text-secondary" data-testid="kanban-overview-rhythm-line">
                <span>{copy.rhythmMedian.replace("{time}", summary.medianMs === null ? "—" : formatSpan(summary.medianMs, copy))}</span>
                <span>· {copy.rhythmRework.replace("{count}", String(summary.reworkCards))}</span>
                {summary.stuckCards > 0
                  ? (
                    <button
                      type="button"
                      aria-pressed={stuckOnly}
                      onClick={onToggleStuck}
                      className={`${buttonClassName("ghost", "xs")} text-danger ${stuckOnly ? "bg-danger-subtle" : ""}`}
                      data-testid="kanban-overview-rhythm-stuck"
                    >
                      {copy.rhythmStuck.replace("{count}", String(summary.stuckCards)).replace("{time}", formatSpan(summary.stuckMs, copy))}
                    </button>
                  )
                  : <span>· {copy.rhythmStuck.replace("{count}", "0").replace("{time}", formatSpan(0, copy))}</span>}
              </div>
            </section>
          );
        })}
      </div>
    </aside>
  );
}
