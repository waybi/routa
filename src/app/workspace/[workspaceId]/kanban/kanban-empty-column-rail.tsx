"use client";

import { useTranslation } from "@/i18n";

/** Width class for a column with no cards: a ~40px rail that is still a drop target. */
export const EMPTY_COLUMN_RAIL_WIDTH_CLASS = "w-10 items-center !px-0";

/**
 * Body of an empty column: vertical column name and a 0 count. The caller
 * keeps it inside the same droppable column so cards can still be dropped in.
 */
export function KanbanEmptyColumnRail({ columnId, name }: { columnId: string; name: string }) {
  const { t } = useTranslation();
  return (
    <div
      className="flex h-full flex-col items-center gap-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400"
      title={t.kanbanEmptyColumn.railHint.replace("{name}", name)}
      data-testid="kanban-empty-column-rail"
      data-column-id={columnId}
    >
      <span className="text-[10px] font-normal text-slate-400 dark:text-slate-500" data-testid={`kanban-column-count-${columnId}`}>0</span>
      <span className="whitespace-nowrap [writing-mode:vertical-rl]">{name}</span>
    </div>
  );
}
