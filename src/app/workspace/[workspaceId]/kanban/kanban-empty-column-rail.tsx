"use client";

import { ChevronRight } from "lucide-react";
import { useTranslation } from "@/i18n";

/** Width class for a column with no cards: a ~40px rail that is still a drop target. */
export const EMPTY_COLUMN_RAIL_WIDTH_CLASS = "w-10 items-center";

/**
 * Body of an empty column: vertical column name and a 0 count. The caller
 * keeps it inside the same droppable column so cards can still be dropped in.
 */
export function KanbanEmptyColumnRail({ columnId, name }: { columnId: string; name: string }) {
  const { t } = useTranslation();
  return (
    <div
      className="flex h-full flex-col items-center gap-2 text-[12px] font-semibold text-primary"
      title={t.kanbanEmptyColumn.railHint.replace("{name}", name)}
      data-testid="kanban-empty-column-rail"
      data-column-id={columnId}
    >
      <span className="whitespace-nowrap [writing-mode:vertical-rl]">{name}</span>
      <span className="font-mono text-[10px] font-normal text-secondary" data-testid={`kanban-column-count-${columnId}`}>0</span>
    </div>
  );
}

/**
 * Body of the collapsed Done column: the same ~40px rail as an empty column,
 * with a vertical expand button (column name), the total count and the
 * unmerged count. The caller keeps it inside the droppable column so cards
 * can still be dropped onto the rail.
 */
export function KanbanDoneCollapsedRail({
  columnId,
  name,
  total,
  unmergedCount,
  onExpand,
}: {
  columnId: string;
  name: string;
  total: number;
  unmergedCount: number;
  onExpand: () => void;
}) {
  const { t } = useTranslation();
  const copy = t.pagesRedesign.doneRail;
  return (
    <div
      className="flex h-full flex-col items-center gap-3 text-[12px] font-semibold text-primary"
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
        className="flex flex-col items-center gap-1 rounded px-0.5 py-1 text-primary transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span className="whitespace-nowrap [writing-mode:vertical-rl]">{name}</span>
        <ChevronRight className="h-3.5 w-3.5 text-secondary" aria-hidden="true" />
      </button>
      <span className="font-mono text-[10px] font-normal text-secondary" data-testid={`kanban-column-count-${columnId}`}>
        {total}
      </span>
      {unmergedCount > 0 && (
        <span
          data-testid="kanban-done-unmerged-count"
          className="whitespace-nowrap rounded bg-attention-subtle px-0.5 py-1 text-[10px] font-medium text-attention [writing-mode:vertical-rl]"
        >
          {copy.unmerged.replace("{count}", String(unmergedCount))}
        </span>
      )}
    </div>
  );
}
