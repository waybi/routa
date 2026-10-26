"use client";

import { ChevronRight } from "lucide-react";
import { useTranslation } from "@/i18n";
import { KanbanLaneMarker } from "./kanban-lane-marker";

/**
 * Width of a narrow column (empty column, collapsed Done): ~88px, enough for
 * the longest column name ("Backlog", "Blocked") written horizontally. Text in
 * a narrow column is always horizontal; when the board does not fit, the board
 * container scrolls sideways. The loading skeleton uses the same value so the
 * board does not jump on load.
 */
export const EMPTY_COLUMN_RAIL_WIDTH = "w-[5.5rem]";

/** Width class for a column with no cards: a narrow rail that is still a drop target. */
export const EMPTY_COLUMN_RAIL_WIDTH_CLASS = `${EMPTY_COLUMN_RAIL_WIDTH} items-center`;

/**
 * Body of an empty column: horizontal column name and a 0 count. The caller
 * keeps it inside the same droppable column so cards can still be dropped in.
 */
export function KanbanEmptyColumnRail({ columnId, name, stage }: { columnId: string; name: string; stage?: string }) {
  const { t } = useTranslation();
  return (
    <div
      className="flex h-full w-full flex-col items-center gap-1 px-1.5 text-center text-[12px] font-semibold text-primary"
      title={t.kanbanEmptyColumn.railHint.replace("{name}", name)}
      data-testid="kanban-empty-column-rail"
      data-column-id={columnId}
    >
      <span className="flex max-w-full items-center gap-1">
        <KanbanLaneMarker stage={stage} />
        <span className="whitespace-nowrap" data-testid="kanban-rail-column-name">{name}</span>
      </span>
      <span className="font-mono text-[10px] font-normal tabular-nums text-secondary" data-testid={`kanban-column-count-${columnId}`}>0</span>
    </div>
  );
}

/**
 * Body of the collapsed Done column: the same narrow rail as an empty column,
 * with a horizontal expand button (column name), the total count, the
 * unmerged count and the lane automation (first step's specialist). The caller
 * keeps it inside the droppable column so cards can still be dropped onto the
 * rail.
 */
export function KanbanDoneCollapsedRail({
  columnId,
  name,
  stage = "done",
  total,
  unmergedCount,
  onExpand,
  automationLabel,
  automationTitle,
}: {
  columnId: string;
  name: string;
  /** Column stage; picks the status marker color. */
  stage?: string;
  total: number;
  unmergedCount: number;
  onExpand: () => void;
  /** Short lane automation label (e.g. the pusher's name); hidden when empty. */
  automationLabel?: string | null;
  /** Full lane automation summary for the tooltip. */
  automationTitle?: string;
}) {
  const { t } = useTranslation();
  const copy = t.pagesRedesign.doneRail;
  return (
    <div
      className="flex h-full w-full flex-col items-center gap-2 px-1.5 text-center text-[12px] font-semibold text-primary"
      aria-label={copy.label.replace("{name}", name)}
      data-testid="kanban-done-collapsed-rail"
      data-column-id={columnId}
    >
      <button
        type="button"
        data-testid="kanban-done-collapse-toggle"
        aria-expanded={false}
        aria-label={copy.expand.replace("{name}", name)}
        title={copy.expand.replace("{name}", name)}
        onClick={onExpand}
        className="flex flex-row items-center gap-0.5 rounded px-1 py-1 text-primary transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent"
      >
        <KanbanLaneMarker stage={stage} />
        <span className="ml-0.5 whitespace-nowrap" data-testid="kanban-rail-column-name">{name}</span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-secondary" aria-hidden="true" />
      </button>
      <span className="font-mono text-[10px] font-normal tabular-nums text-secondary" data-testid={`kanban-column-count-${columnId}`}>
        {total}
      </span>
      {unmergedCount > 0 && (
        <span
          data-testid="kanban-done-unmerged-count"
          className="max-w-full whitespace-normal break-words rounded bg-attention-subtle px-1 py-0.5 text-center text-[10px] font-medium leading-tight tabular-nums text-attention"
        >
          {copy.unmerged.replace("{count}", String(unmergedCount))}
        </span>
      )}
      {automationLabel && (
        <span
          data-testid={`kanban-rail-automation-${columnId}`}
          title={automationTitle}
          className="max-w-full whitespace-normal break-words text-center text-[10px] font-normal leading-tight text-secondary"
        >
          {automationLabel}
        </span>
      )}
    </div>
  );
}
