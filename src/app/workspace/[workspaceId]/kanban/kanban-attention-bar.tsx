"use client";

/**
 * "Needs your attention" strip between the toolbar and the board: blocked
 * cards, failed Done lanes, finished-without-report and unmerged cards.
 * Click an item to open the card; "Got it" hides it until it changes.
 */

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "@/i18n";
import type { KanbanBoardInfo, TaskInfo } from "../types";
import {
  attentionDismissKey,
  collectAttentionItems,
  type KanbanAttentionKind,
} from "./kanban-attention-rules";
import { useKanbanAttentionDismissals } from "./use-kanban-attention-dismissals";

const KIND_TONE: Record<KanbanAttentionKind, string> = {
  blocked: "bg-red-100 text-red-600 ring-red-200 dark:bg-red-900/20 dark:text-red-400 dark:ring-red-900/40",
  doneFailed: "bg-red-100 text-red-600 ring-red-200 dark:bg-red-900/20 dark:text-red-400 dark:ring-red-900/40",
  noReport: "bg-red-100 text-red-600 ring-red-200 dark:bg-red-900/20 dark:text-red-400 dark:ring-red-900/40",
  unmerged: "bg-amber-100/80 text-amber-800 ring-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:ring-amber-900/40",
};

/** Wall clock refreshed once a minute, so the 7-day window keeps moving. */
function useMinuteClock(fixed: number | undefined): number {
  const [now, setNow] = useState(() => fixed ?? Date.now());
  useEffect(() => {
    if (fixed !== undefined) return;
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [fixed]);
  return fixed ?? now;
}

export function KanbanAttentionBar({
  board,
  tasks,
  onOpenTask,
  now,
}: {
  board: KanbanBoardInfo;
  /** Tasks of the current board only. */
  tasks: TaskInfo[];
  onOpenTask: (task: TaskInfo) => void;
  /** Injected for tests; defaults to render time. */
  now?: number;
}) {
  const { t } = useTranslation();
  const { dismissed, dismiss } = useKanbanAttentionDismissals(board.id);
  const at = useMinuteClock(now);
  const tasksById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const items = collectAttentionItems(tasks, board, at)
    .filter((item) => !dismissed.includes(attentionDismissKey(item)));

  if (items.length === 0) return null;

  const kindLabel = (kind: KanbanAttentionKind, ahead: number) => (kind === "unmerged"
    ? t.kanbanAttention.unmerged.replace("{count}", String(ahead))
    : t.kanbanAttention[kind]);

  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-amber-200/70 bg-amber-50/60 px-4 py-1.5 text-[11px] dark:border-amber-900/30 dark:bg-amber-900/10"
      data-testid="kanban-attention-bar"
    >
      <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-amber-800 dark:text-amber-300">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        {t.kanbanAttention.title}
        <span className="font-normal text-amber-700/80 dark:text-amber-300/70">{items.length}</span>
      </span>
      {items.map((item) => {
        const task = tasksById.get(item.taskId);
        if (!task) return null;
        const key = attentionDismissKey(item);
        return (
          <span
            key={key}
            className="inline-flex max-w-[22rem] items-center gap-1 rounded-md border border-slate-200 bg-white pl-1 pr-0.5 dark:border-slate-700 dark:bg-[#12141c]"
            data-testid="kanban-attention-item"
            data-kind={item.kind}
            data-task-id={item.taskId}
          >
            <button
              type="button"
              onClick={() => onOpenTask(task)}
              className="inline-flex min-w-0 items-center gap-1 py-0.5 text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
              title={task.title}
              data-testid="kanban-attention-open"
            >
              <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium ring-1 ring-inset ${KIND_TONE[item.kind]}`}>
                {kindLabel(item.kind, item.ahead)}
              </span>
              <span className="truncate">{task.title}</span>
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                dismiss(key);
              }}
              className="shrink-0 rounded px-1 py-0.5 text-[10px] text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-[#1f232f] dark:hover:text-slate-300"
              data-testid="kanban-attention-dismiss"
            >
              {t.kanbanAttention.dismiss}
            </button>
          </span>
        );
      })}
    </div>
  );
}
