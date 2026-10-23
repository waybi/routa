"use client";

/**
 * Bulk rerun bar above the "Needs you" list, shown whenever active rows are
 * interrupted: "N cards interrupted", select all, "Rerun selected (k)", an
 * in-page confirmation (never window.confirm) and the result summary.
 */

import { useTranslation } from "@/i18n";
import { buttonClassName } from "@/client/components/ui/button";
import type { RetrySummary } from "./inbox-retry";

export function InboxBulkBar({
  interruptedCount,
  selectableCount,
  selectedCount,
  running,
  confirming,
  onSelectAll,
  onAskConfirm,
  onConfirm,
  onCancel,
}: {
  interruptedCount: number;
  selectableCount: number;
  selectedCount: number;
  running: boolean;
  confirming: boolean;
  onSelectAll: (on: boolean) => void;
  onAskConfirm: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const page = t.inboxPage;
  const allSelected = selectableCount > 0 && selectedCount === selectableCount;
  return (
    <div className="mt-3 flex flex-col gap-2 rounded-md border border-danger bg-danger-subtle px-3 py-2" data-testid="inbox-bulk-bar">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="font-semibold text-danger" data-testid="inbox-bulk-count">
          {page.bulkInterrupted.replace("{count}", String(interruptedCount))}
        </span>
        <label className="inline-flex items-center gap-1.5 text-primary">
          <input
            type="checkbox"
            checked={allSelected}
            disabled={running || selectableCount === 0}
            onChange={(event) => onSelectAll(event.target.checked)}
            data-testid="inbox-bulk-select-all"
          />
          {page.selectAll}
        </label>
        <button
          type="button"
          className={buttonClassName("primary", "sm")}
          disabled={running || selectedCount === 0}
          onClick={onAskConfirm}
          data-testid="inbox-bulk-rerun"
        >
          {page.bulkRerun.replace("{count}", String(selectedCount))}
        </button>
      </div>
      {confirming && (
        <div role="alertdialog" aria-label={page.bulkRerun.replace("{count}", String(selectedCount))} className="flex flex-wrap items-center gap-2 text-xs text-primary" data-testid="inbox-bulk-confirm">
          <span>{page.bulkConfirm.replace("{count}", String(selectedCount))}</span>
          <button type="button" className={buttonClassName("danger", "sm")} disabled={running} onClick={onConfirm} data-testid="inbox-bulk-confirm-yes">
            {page.bulkConfirmYes}
          </button>
          <button type="button" className={buttonClassName("ghost", "sm")} onClick={onCancel} data-testid="inbox-bulk-confirm-no">
            {page.bulkConfirmNo}
          </button>
        </div>
      )}
    </div>
  );
}

export function InboxRetrySummary({ summary }: { summary: RetrySummary }) {
  const { t } = useTranslation();
  return (
    <p role="status" className="m-0 mt-3 text-xs font-medium text-primary" data-testid="inbox-bulk-summary">
      {t.inboxPage.bulkSummary
        .replace("{started}", String(summary.started))
        .replace("{queued}", String(summary.queued))
        .replace("{skipped}", String(summary.skipped))
        .replace("{failed}", String(summary.failed))}
    </p>
  );
}
