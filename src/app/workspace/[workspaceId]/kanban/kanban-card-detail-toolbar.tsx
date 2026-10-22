"use client";

import { Maximize2, Minimize2, PanelRightOpen, RefreshCw, X } from "lucide-react";
import { buttonClassName } from "@/client/components/ui/button";
import { useTranslation } from "@/i18n";

/** Shared style for the card-detail pane buttons: close card detail, hide session pane, show session pane. */
export const DETAIL_PANE_BUTTON_CLASS = `${buttonClassName("secondary", "sm")} shrink-0 whitespace-nowrap`;

/** The single close button is the primary (accent) action of the toolbar. */
const CLOSE_BUTTON_CLASS = `${buttonClassName("primary", "sm")} shrink-0 whitespace-nowrap`;

export interface KanbanCardDetailToolbarProps {
  compactMode: boolean;
  isFullscreen: boolean;
  /** Card id; its first 8 characters are shown next to the "Card Detail" label. */
  cardId?: string;
  onToggleFullscreen?: (next: boolean) => void;
  onClose?: () => void;
  onRefresh: () => void;
  /** Label for the "show session pane" button; the button is hidden when undefined. */
  showSessionPaneLabel?: string;
  onShowSessionPane?: () => void;
}

/**
 * Sticky top bar of the card detail: fullscreen, show session pane, refresh
 * and the one "Close card detail" button (last, accent) stay visible while
 * the detail body scrolls underneath.
 */
export function KanbanCardDetailToolbar({
  compactMode,
  isFullscreen,
  cardId,
  onToggleFullscreen,
  onClose,
  onRefresh,
  showSessionPaneLabel,
  onShowSessionPane,
}: KanbanCardDetailToolbarProps) {
  const { t } = useTranslation();
  const fullscreenLabel = isFullscreen ? t.kanbanDetail.exitFullscreen : t.kanbanDetail.enterFullscreen;

  return (
    <div
      className={`sticky top-0 z-20 flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-default bg-canvas py-2 ${compactMode ? "pl-3" : "pl-4"} pr-4`}
      data-testid="kanban-detail-sticky-toolbar"
    >
      <div className="flex min-w-0 items-baseline gap-2 text-[13px] text-secondary">
        <span>{t.kanbanDetail.cardDetail}</span>
        {cardId ? <span className="truncate font-mono text-xs">{cardId.slice(0, 8)}</span> : null}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {onToggleFullscreen ? (
          <button
            type="button"
            onClick={() => onToggleFullscreen(!isFullscreen)}
            className={DETAIL_PANE_BUTTON_CLASS}
            aria-label={fullscreenLabel}
            title={fullscreenLabel}
          >
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" /> : <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />}
            <span className="hidden lg:inline">{fullscreenLabel}</span>
          </button>
        ) : null}
        {showSessionPaneLabel && onShowSessionPane ? (
          <button type="button" onClick={onShowSessionPane} className={DETAIL_PANE_BUTTON_CLASS}>
            <PanelRightOpen className="h-4 w-4" aria-hidden="true" />
            <span>{showSessionPaneLabel}</span>
          </button>
        ) : null}
        <button type="button" onClick={onRefresh} className={DETAIL_PANE_BUTTON_CLASS} aria-label={t.common.refresh}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden lg:inline">{t.common.refresh}</span>
        </button>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className={CLOSE_BUTTON_CLASS}
            aria-label={t.kanbanDetail.closeCardDetail}
            title={t.kanbanDetailOverlay.closeWithEscHint}
            data-testid="kanban-detail-close"
          >
            <X className="h-4 w-4" aria-hidden="true" />
            <span>{t.kanbanDetail.closeCardDetail}</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
