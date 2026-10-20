"use client";

import { useTranslation } from "@/i18n";
import { DONE_COLUMN_PAGE_SIZE, type DoneColumnWindow } from "./kanban-done-column-window";

const BUTTON_CLASS =
  "rounded-md px-1.5 py-0.5 text-[10px] font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200";

export function KanbanDoneCollapseToggle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      data-testid="kanban-done-collapse-toggle"
      aria-expanded={!collapsed}
      onClick={onToggle}
      className={BUTTON_CLASS}
    >
      {collapsed ? t.kanbanDoneColumn.expand : t.kanbanDoneColumn.collapse}
    </button>
  );
}

/** "Show N earlier" while cards are hidden; "Show less" once all are shown. */
export function KanbanDoneColumnFooter({
  doneWindow,
  onShowMore,
  onShowLess,
}: {
  doneWindow: DoneColumnWindow;
  onShowMore: () => void;
  onShowLess: () => void;
}) {
  const { t } = useTranslation();
  if (doneWindow.hiddenCount > 0) {
    return (
      <button
        type="button"
        data-testid="kanban-done-show-more"
        onClick={onShowMore}
        className={`${BUTTON_CLASS} w-full py-1`}
      >
        {t.kanbanDoneColumn.showEarlier.replace("{count}", String(doneWindow.nextStep))}
      </button>
    );
  }
  if (doneWindow.visible.length > DONE_COLUMN_PAGE_SIZE) {
    return (
      <button
        type="button"
        data-testid="kanban-done-show-more"
        onClick={onShowLess}
        className={`${BUTTON_CLASS} w-full py-1`}
      >
        {t.kanbanDoneColumn.showLess}
      </button>
    );
  }
  return null;
}
