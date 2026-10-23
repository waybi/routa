"use client";

import { ChevronRight } from "lucide-react";
import { useTranslation } from "@/i18n";
import type { RailMode } from "./kanban-rail-mode";

/**
 * Width of a horizontal narrow column (empty column, collapsed Done): ~88px,
 * enough for the longest column name ("Backlog", "Blocked") written
 * horizontally. Used when the board has room (see kanban-rail-mode.ts).
 */
export const EMPTY_COLUMN_RAIL_WIDTH = "w-[5.5rem]";

/** Width of a vertical narrow column: the ~40px rail used when the board has no room. */
export const EMPTY_COLUMN_RAIL_VERTICAL_WIDTH = "w-10";

/** Width class for a horizontal narrow column that is still a drop target. */
export const EMPTY_COLUMN_RAIL_WIDTH_CLASS = `${EMPTY_COLUMN_RAIL_WIDTH} items-center`;

/** Width of a narrow column in the given mode. */
export function emptyColumnRailWidth(mode: RailMode): string {
  return mode === "vertical" ? EMPTY_COLUMN_RAIL_VERTICAL_WIDTH : EMPTY_COLUMN_RAIL_WIDTH;
}

/** Width class of a narrow column (column container) in the given mode. */
export function emptyColumnRailWidthClass(mode: RailMode): string {
  return `${emptyColumnRailWidth(mode)} items-center`;
}

const VERTICAL_TEXT = "whitespace-nowrap [writing-mode:vertical-rl]";

/**
 * Body of an empty column: column name and a 0 count, horizontal or vertical
 * depending on the board's rail mode. The caller keeps it inside the same
 * droppable column so cards can still be dropped in.
 */
export function KanbanEmptyColumnRail({ columnId, name, mode = "horizontal" }: { columnId: string; name: string; mode?: RailMode }) {
  const { t } = useTranslation();
  const vertical = mode === "vertical";
  return (
    <div
      className={vertical
        ? "flex h-full flex-col items-center gap-2 text-[12px] font-semibold text-primary"
        : "flex h-full w-full flex-col items-center gap-1 px-1.5 text-center text-[12px] font-semibold text-primary"}
      title={t.kanbanEmptyColumn.railHint.replace("{name}", name)}
      data-testid="kanban-empty-column-rail"
      data-column-id={columnId}
      data-rail-mode={mode}
    >
      <span className={vertical ? VERTICAL_TEXT : "whitespace-nowrap"} data-testid="kanban-rail-column-name">{name}</span>
      <span className="font-mono text-[10px] font-normal tabular-nums text-secondary" data-testid={`kanban-column-count-${columnId}`}>0</span>
    </div>
  );
}

/**
 * Body of the collapsed Done column: the same narrow rail as an empty column,
 * with an expand button (column name), the total count, the unmerged count and
 * the lane automation (first step's specialist), horizontal or vertical
 * depending on the board's rail mode. The caller keeps it inside the droppable
 * column so cards can still be dropped onto the rail.
 */
export function KanbanDoneCollapsedRail({
  columnId,
  name,
  total,
  unmergedCount,
  onExpand,
  mode = "horizontal",
  automationLabel,
  automationTitle,
}: {
  columnId: string;
  name: string;
  total: number;
  unmergedCount: number;
  onExpand: () => void;
  mode?: RailMode;
  /** Short lane automation label (e.g. the pusher's name); hidden when empty. */
  automationLabel?: string | null;
  /** Full lane automation summary for the tooltip. */
  automationTitle?: string;
}) {
  const { t } = useTranslation();
  const copy = t.pagesRedesign.doneRail;
  const vertical = mode === "vertical";
  return (
    <div
      className={vertical
        ? "flex h-full flex-col items-center gap-3 text-[12px] font-semibold text-primary"
        : "flex h-full w-full flex-col items-center gap-2 px-1.5 text-center text-[12px] font-semibold text-primary"}
      aria-label={copy.label.replace("{name}", name)}
      data-testid="kanban-done-collapsed-rail"
      data-column-id={columnId}
      data-rail-mode={mode}
    >
      <button
        type="button"
        data-testid="kanban-done-collapse-toggle"
        aria-expanded={false}
        aria-label={copy.expand.replace("{name}", name)}
        title={copy.expand.replace("{name}", name)}
        onClick={onExpand}
        className={`${vertical ? "flex flex-col items-center gap-1 px-0.5" : "flex flex-row items-center gap-0.5 px-1"} rounded py-1 text-primary transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent`}
      >
        <span className={vertical ? VERTICAL_TEXT : "whitespace-nowrap"} data-testid="kanban-rail-column-name">{name}</span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-secondary" aria-hidden="true" />
      </button>
      <span className="font-mono text-[10px] font-normal tabular-nums text-secondary" data-testid={`kanban-column-count-${columnId}`}>
        {total}
      </span>
      {unmergedCount > 0 && (
        <span
          data-testid="kanban-done-unmerged-count"
          className={vertical
            ? `rounded bg-attention-subtle px-0.5 py-1 text-[10px] font-medium tabular-nums text-attention ${VERTICAL_TEXT}`
            : "max-w-full whitespace-normal break-words rounded bg-attention-subtle px-1 py-0.5 text-center text-[10px] font-medium leading-tight tabular-nums text-attention"}
        >
          {copy.unmerged.replace("{count}", String(unmergedCount))}
        </span>
      )}
      {automationLabel && (
        <span
          data-testid={`kanban-rail-automation-${columnId}`}
          title={automationTitle}
          className={vertical
            ? `text-[10px] font-normal text-secondary ${VERTICAL_TEXT}`
            : "max-w-full whitespace-normal break-words text-center text-[10px] font-normal leading-tight text-secondary"}
        >
          {automationLabel}
        </span>
      )}
    </div>
  );
}
