"use client";

import type { ReactNode } from "react";
import { useTranslation } from "@/i18n";
import { Button } from "@/client/components/ui/button";
import { DONE_COLUMN_PAGE_SIZE, type DoneColumnWindow } from "./kanban-done-column-window";

const BUTTON_CLASS =
  "rounded px-1.5 py-0.5 text-[11px] font-medium text-secondary transition-colors hover:bg-hover hover:text-primary focus-visible:outline-2 focus-visible:outline-accent";

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

/**
 * "Show N earlier" while cards are hidden; "Show less" once all are shown.
 * The right-hand counter always says how many are on screen out of the total.
 */
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
  const counter = (
    <span className="ml-auto shrink-0 font-mono text-[10px] text-secondary" data-testid="kanban-done-window-count">
      {t.kanbanDoneColumn.windowCount
        .replace("{shown}", String(doneWindow.visible.length))
        .replace("{total}", String(doneWindow.total))}
    </span>
  );
  let action: ReactNode = null;
  if (doneWindow.hiddenCount > 0) {
    action = (
      <Button variant="secondary" size="xs" data-testid="kanban-done-show-more" onClick={onShowMore}>
        {t.kanbanDoneColumn.showEarlier.replace("{count}", String(doneWindow.nextStep))}
      </Button>
    );
  } else if (doneWindow.visible.length > DONE_COLUMN_PAGE_SIZE) {
    action = (
      <Button variant="secondary" size="xs" data-testid="kanban-done-show-more" onClick={onShowLess}>
        {t.kanbanDoneColumn.showLess}
      </Button>
    );
  }
  if (!action && doneWindow.total === 0) return null;
  return (
    <div className="flex items-center gap-2 border-t border-default pt-2" data-testid="kanban-done-footer">
      {action}
      {counter}
    </div>
  );
}
