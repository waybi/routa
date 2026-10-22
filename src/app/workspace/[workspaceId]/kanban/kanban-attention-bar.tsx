"use client";

/**
 * "Needs your attention" strip between the toolbar and the board: blocked
 * cards, failed Done lanes, finished-without-report and unmerged cards.
 * Click an item to open the card; "Got it" hides it until it changes.
 */

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "@/i18n";
import { Badge, type Tone } from "@/client/components/ui/badge";
import type { KanbanBoardInfo, TaskInfo } from "../types";
import {
  attentionDismissKey,
  collectAttentionItems,
  type KanbanAttentionKind,
} from "./kanban-attention-rules";
import { useKanbanAttentionDismissals } from "./use-kanban-attention-dismissals";

const KIND_TONE: Record<KanbanAttentionKind, Tone> = {
  blocked: "danger",
  doneFailed: "danger",
  noReport: "danger",
  unmerged: "attention",
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
      role="region"
      aria-label={t.kanbanAttention.title}
      className="mb-3 flex shrink-0 flex-wrap items-center gap-2 rounded-control border border-attention bg-attention-subtle px-3 py-2 text-[12px]"
      data-testid="kanban-attention-bar"
    >
      <span className="inline-flex shrink-0 items-center gap-1.5 font-semibold text-attention">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        {t.kanbanAttention.title}
        <span className="font-mono font-normal">{items.length}</span>
      </span>
      {items.map((item) => {
        const task = tasksById.get(item.taskId);
        if (!task) return null;
        const key = attentionDismissKey(item);
        return (
          <span
            key={key}
            className="inline-flex max-w-[24rem] items-center gap-1 rounded-control border border-default bg-surface pl-1.5 pr-0.5"
            data-testid="kanban-attention-item"
            data-kind={item.kind}
            data-task-id={item.taskId}
          >
            <button
              type="button"
              onClick={() => onOpenTask(task)}
              className="inline-flex min-w-0 items-center gap-1.5 py-1 text-primary hover:underline focus-visible:outline-2 focus-visible:outline-accent"
              title={task.title}
              data-testid="kanban-attention-open"
            >
              <Badge tone={KIND_TONE[item.kind]} className="shrink-0">
                {kindLabel(item.kind, item.ahead)}
              </Badge>
              <span className="truncate">{task.title}</span>
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                dismiss(key);
              }}
              className="shrink-0 rounded px-1.5 py-1 text-[11px] text-secondary hover:bg-hover hover:text-primary focus-visible:outline-2 focus-visible:outline-accent"
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
