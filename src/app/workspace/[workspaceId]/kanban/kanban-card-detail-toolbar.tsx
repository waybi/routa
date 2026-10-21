"use client";

import { Maximize2, Minimize2, PanelRightOpen, X } from "lucide-react";
import { useTranslation } from "@/i18n";

const PILL_BUTTON_CLASS = "inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600 transition-colors hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 dark:border-slate-700 dark:bg-[#0d1018] dark:text-slate-300 dark:hover:border-amber-700 dark:hover:bg-amber-900/20 dark:hover:text-amber-200";

/** Shared pill style for the card-detail pane buttons: close card detail, hide session pane, show session pane. */
export const DETAIL_PANE_BUTTON_CLASS = "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-slate-300 bg-slate-50 px-3.5 text-[13px] font-semibold text-slate-700 transition-colors hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 dark:border-slate-600 dark:bg-[#0d1018] dark:text-slate-200 dark:hover:border-amber-700 dark:hover:bg-amber-900/20 dark:hover:text-amber-200";

export interface KanbanCardDetailToolbarProps {
  compactMode: boolean;
  isFullscreen: boolean;
  onToggleFullscreen?: (next: boolean) => void;
  onClose?: () => void;
  onRefresh: () => void;
  /** Label for the "show session pane" button; the button is hidden when undefined. */
  showSessionPaneLabel?: string;
  onShowSessionPane?: () => void;
}

export function KanbanCardDetailToolbar({
  compactMode,
  isFullscreen,
  onToggleFullscreen,
  onClose,
  onRefresh,
  showSessionPaneLabel,
  onShowSessionPane,
}: KanbanCardDetailToolbarProps) {
  const { t } = useTranslation();

  return (
    <div className={`sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-transparent bg-white/95 backdrop-blur dark:bg-[#12141c]/95 ${compactMode ? "-mx-3 -mt-3 -mb-2 pl-3 pb-1 pt-3" : "-mx-4 -mt-4 -mb-3 pl-4 pb-1.5 pt-4"} ${compactMode ? "pr-3" : "pr-4"}`} data-testid="kanban-detail-sticky-toolbar">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
        {t.kanbanDetail.cardDetail}
      </div>
      <div className="flex items-center gap-1.5">
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className={DETAIL_PANE_BUTTON_CLASS}
            aria-label={t.kanbanDetail.closeCardDetail}
            title={t.kanbanDetailOverlay.closeWithEscHint}
          >
            <X className="h-4 w-4" aria-hidden="true" />
            <span>{t.kanbanDetail.closeCardDetail}</span>
          </button>
        ) : null}
        {showSessionPaneLabel && onShowSessionPane ? (
          <button type="button" onClick={onShowSessionPane} className={DETAIL_PANE_BUTTON_CLASS}>
            <PanelRightOpen className="h-4 w-4" aria-hidden="true" />
            <span>{showSessionPaneLabel}</span>
          </button>
        ) : null}
        {onToggleFullscreen ? (
          <button
            type="button"
            onClick={() => onToggleFullscreen(!isFullscreen)}
            className="inline-flex h-6 w-6 items-center justify-center border border-slate-300/80 text-slate-500 transition-colors hover:border-amber-400 hover:text-amber-700 dark:border-slate-700 dark:text-slate-300 dark:hover:border-amber-700 dark:hover:text-amber-200"
            aria-label={isFullscreen ? t.kanbanDetail.exitFullscreen : t.kanbanDetail.enterFullscreen}
            title={isFullscreen ? t.kanbanDetail.exitFullscreen : t.kanbanDetail.enterFullscreen}
          >
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        ) : null}
        <button type="button" onClick={onRefresh} className={PILL_BUTTON_CLASS}>
          {t.common.refresh}
        </button>
      </div>
    </div>
  );
}
