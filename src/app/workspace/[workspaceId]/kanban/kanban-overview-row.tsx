"use client";

/** One workspace row of the all-projects overview: head plus the three blocks. */

import { useMemo } from "react";
import { Badge, StatusDot } from "@/client/components/ui/badge";
import { buttonClassName } from "@/client/components/ui/button";
import { useTranslation } from "@/i18n";
import type { KanbanBoardInfo, TaskInfo } from "../types";
import type { KanbanAttentionKind } from "./kanban-attention-rules";
import { getDoneEnteredAt } from "./kanban-done-time";
import { HighlightedText, normalizeSearchQuery } from "./kanban-board-search";
import { formatDoneShort, shortSha, type OverviewAttentionEntry, type OverviewRow } from "./kanban-overview-rules";
import { classifyOverviewTask } from "./kanban-overview-status-rules";
import { KanbanOverviewProgress } from "./kanban-overview-progress";
import type { OverviewWorkspaceData } from "./use-kanban-overview-data";
import { KanbanLaneMarker } from "./kanban-lane-marker";
import { InboxReasonCell } from "../overview/inbox-reason-cell";
import { inboxReason, inboxReasonText } from "../overview/inbox-rules";

export function columnName(task: TaskInfo, boards: readonly KanbanBoardInfo[]): string {
  const board = boards.find((item) => item.id === task.boardId) ?? boards.find((item) => item.isDefault) ?? boards[0];
  return board?.columns.find((column) => column.id === task.columnId)?.name ?? task.columnId ?? "";
}

const cardClass = "flex w-full min-w-0 items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-[11px] text-primary hover:bg-hover";
const REASON_MAX_CHARS = 90;

interface BlockProps {
  title: string;
  /** Lane stage whose status color marks the block title. */
  tone: "dev" | "blocked" | "done";
  count: string;
  testId: string;
  /** No cards: the block shrinks to one dashed line. */
  empty?: boolean;
  grow?: boolean;
  children: React.ReactNode;
}

function Block({ title, tone, count, testId, empty, grow, children }: BlockProps) {
  const frame = empty
    ? "rounded-md border border-dashed border-default px-2 py-1.5"
    : "rounded-md border-[length:var(--kanban-block-border-width)] border-solid border-[color:var(--kanban-block-border)] bg-[color:var(--kanban-block-bg)] p-1.5";
  return (
    <section className={`min-w-0 flex-1 ${frame}`} data-testid={testId} data-empty={empty ? "true" : "false"}>
      <header className={`flex items-center gap-1.5 px-1 text-[11px] ${empty ? "text-secondary" : "mb-1 font-semibold text-primary"}`} data-testid={`${testId}-header`}>
        {!empty && <KanbanLaneMarker stage={tone} />}
        {title}
        <span className="font-normal text-secondary">{count}</span>
      </header>
      {!empty && <div className={`${grow ? "max-h-96" : "max-h-40"} space-y-0.5 overflow-y-auto`}>{children}</div>}
    </section>
  );
}

function BlockedReason({ entry, commentsOf }: { entry: OverviewAttentionEntry; commentsOf: (task: TaskInfo) => TaskInfo["comments"] }) {
  const { t } = useTranslation();
  const page = t.inboxPage;
  const { task } = entry;
  if (inboxReason(entry.item, task) === "blockedError") {
    const error = task.lastSyncError?.trim() ?? "";
    const clipped = error.length > REASON_MAX_CHARS ? `${error.slice(0, REASON_MAX_CHARS)}…` : error;
    return <span className="block px-1.5 pb-1 text-[11px] text-danger" title={error} data-testid="kanban-overview-blocked-reason">{page.reasonBlockedError.replace("{error}", clipped)}</span>;
  }
  const reason = inboxReasonText(task, commentsOf(task));
  return (
    <span className="block px-1.5 pb-1 text-[11px]" data-testid="kanban-overview-blocked-reason" title={reason?.full}>
      {reason
        ? <InboxReasonCell reason={reason} labels={{ expand: page.reasonExpand, collapse: page.reasonCollapse }} maxChars={REASON_MAX_CHARS} />
        : <span className="text-secondary">{page.reasonBlockedUnknown}</span>}
    </span>
  );
}

export interface WorkspaceRowProps {
  row: OverviewRow;
  data: OverviewWorkspaceData;
  query: string;
  now: number;
  expanded: boolean;
  onToggleExpand: () => void;
  onOpenTask: (task: TaskInfo, row: OverviewRow, trigger: HTMLElement) => void;
  onRetry: () => void;
  commentsOf: (task: TaskInfo) => TaskInfo["comments"];
}

export function WorkspaceRow({ row, data, query, now, expanded, onToggleExpand, onOpenTask, onRetry, commentsOf }: WorkspaceRowProps) {
  const { t } = useTranslation();
  const copy = t.kanbanOverview;
  const count = (n: number) => copy.blockCount.replace("{count}", String(n));
  const kindLabel = (kind: KanbanAttentionKind, ahead: number) => (kind === "unmerged"
    ? t.kanbanAttention.unmerged.replace("{count}", String(ahead))
    : t.kanbanAttention[kind]);
  const searching = normalizeSearchQuery(query).length > 0;
  const attentionIds = useMemo(() => new Set(row.attentionAll.map((entry) => entry.task.id)), [row.attentionAll]);
  const openButton = (task: TaskInfo, body: React.ReactNode) => (
    <button key={task.id} type="button" className={cardClass} title={task.title} onClick={(event) => onOpenTask(task, row, event.currentTarget)} data-testid="kanban-overview-card" data-task-id={task.id}>
      {body}
    </button>
  );

  const head = (
    <div className="w-44 shrink-0">
      <div className="truncate text-[12px] font-semibold text-primary">{row.title}</div>
      <div className="text-[11px] text-secondary">{copy.cardCount.replace("{count}", String(row.totalCount))}</div>
      {data.status === "ready" && row.queuedCount > 0 && (
        <span className="mt-0.5 mr-1 inline-block" data-testid="kanban-overview-queued">
          <Badge tone="info">{copy.queuedBadge.replace("{count}", String(row.queuedCount))}</Badge>
        </span>
      )}
      {row.showsNoUnmergedBadge && data.status === "ready" && (
        <span className="mt-0.5 inline-block rounded bg-subtle px-1.5 text-[10px] text-secondary" title={copy.noUnmergedHint} data-testid="kanban-overview-no-unmerged">
          {copy.noUnmergedBadge}
        </span>
      )}
    </div>
  );

  let body: React.ReactNode;
  if (data.status === "error") {
    body = (
      <div className="flex items-center gap-2 text-[11px] text-danger" data-testid="kanban-overview-error">
        {copy.loadFailed}
        <button type="button" onClick={onRetry} className={buttonClassName("secondary", "xs")} data-testid="kanban-overview-retry">
          {copy.retry}
        </button>
      </div>
    );
  } else if (data.status === "loading") {
    body = <div className="text-[11px] text-secondary">{copy.loading}</div>;
  } else if (row.collapsed) {
    body = <div className="text-[11px] text-secondary">{copy.emptyRow}</div>;
  } else {
    const doneTitle = searching ? copy.recentDoneMatches.replace("{count}", String(row.recentDone.total)) : copy.recentDone7d;
    const doneShown = expanded ? row.recentDone.all : row.recentDone.items;
    const hidden = row.recentDone.total - row.recentDone.items.length;
    body = (
      <div className="flex min-w-0 flex-1 gap-2">
        <Block title={copy.inProgress} tone="dev" count={count(row.inProgress.length)} testId="kanban-overview-in-progress" empty={row.inProgress.length === 0}>
          {row.inProgress.map((task) => {
            const status = classifyOverviewTask(task, attentionIds);
            const label = columnName(task, data.boards);
            return (
              <div key={task.id} className="rounded hover:bg-hover">
                {openButton(task, (
                  <>
                    <StatusDot tone={status === "running" ? "attention" : "info"} pulse={status === "running"} label={label} className="shrink-0 text-[10px]" />
                    <span className="truncate"><HighlightedText text={task.title} query={query} /></span>
                  </>
                ))}
                <div className="px-1.5 pb-0.5"><KanbanOverviewProgress task={task} laneLabel={label} now={now} /></div>
              </div>
            );
          })}
        </Block>
        <Block title={copy.needsYou} tone="blocked" count={count(row.attention.length)} testId="kanban-overview-attention" empty={row.attention.length === 0}>
          {row.attention.map((entry) => (
            <span key={`${entry.task.id}|${entry.item.kind}`} className="block" data-kind={entry.item.kind}>
              {openButton(entry.task, (
                <>
                  <span className="shrink-0 rounded bg-danger-subtle px-1.5 text-[10px] text-danger">{kindLabel(entry.item.kind, entry.item.ahead)}</span>
                  <span className="truncate"><HighlightedText text={entry.task.title} query={query} /></span>
                </>
              ))}
              {entry.item.kind === "blocked" && <BlockedReason entry={entry} commentsOf={commentsOf} />}
            </span>
          ))}
        </Block>
        <Block
          tone="done"
          title={doneTitle}
          count={searching ? "" : count(row.recentDone.total)}
          testId="kanban-overview-recent-done"
          empty={row.recentDone.total === 0}
          grow={expanded}
        >
          {doneShown.map((task) => {
            const sha = shortSha(task.completionReport?.commit);
            return (
              <button key={task.id} type="button" className={cardClass} title={task.completionReport?.excerpt || task.title} onClick={(event) => onOpenTask(task, row, event.currentTarget)} data-testid="kanban-overview-card" data-task-id={task.id}>
                <span className="shrink-0 font-mono text-[10px] text-secondary">{formatDoneShort(getDoneEnteredAt(task))}</span>
                <span className="truncate"><HighlightedText text={task.title} query={query} /></span>
                {sha && <span className="shrink-0 font-mono text-[10px] text-secondary"><HighlightedText text={sha} query={query} /></span>}
              </button>
            );
          })}
          {hidden > 0 && (
            <button type="button" onClick={onToggleExpand} aria-expanded={expanded} className={`${buttonClassName("ghost", "xs")} text-accent`} data-testid="kanban-overview-expand-done">
              {expanded ? copy.collapseRest : copy.expandRest.replace("{count}", String(hidden))}
            </button>
          )}
        </Block>
      </div>
    );
  }

  return (
    <div
      className={`flex items-start gap-3 border-b border-default px-1 ${row.collapsed && data.status === "ready" ? "py-1.5" : "py-2"}`}
      data-testid="kanban-overview-row"
      data-workspace-id={row.workspaceId}
      data-collapsed={row.collapsed && data.status === "ready" ? "true" : "false"}
    >
      {head}
      {body}
    </div>
  );
}
