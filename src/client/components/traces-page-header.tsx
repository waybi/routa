"use client";

import React from "react";
import { useTranslation } from "@/i18n";
import { Button } from "./button";
import { SettingsPageHeader } from "./settings-page-header";
import { Copy } from "lucide-react";


interface TracesPageHeaderProps {
  selectedSessionId: string | null;
  showSidebar: boolean;
  loading: boolean;
  onCopyCurrentUrl: () => void;
  onToggleSidebar: () => void;
  onRefresh: () => void;
}

/**
 * Traces page header: the shared 21px page header (design-spec §2) with the
 * session chip and the copy / sidebar / refresh actions on the right. The
 * wrapper keeps data-testid="traces-page-header" for the visual spec.
 */
export function TracesPageHeader({
  selectedSessionId,
  showSidebar,
  loading,
  onCopyCurrentUrl,
  onToggleSidebar,
  onRefresh,
}: TracesPageHeaderProps) {
  const { t } = useTranslation();
  const header = t.pagesRedesign.headers.traces;
  return (
    <div className="shrink-0" data-testid="traces-page-header">
      <SettingsPageHeader
        title={header.title}
        description={header.description}
        actions={(
          <>
            {selectedSessionId && (
              <span
                className="inline-flex items-center gap-1.5 rounded-control border border-default bg-surface px-2 py-1 text-[11px] text-secondary"
                data-testid="traces-selected-session"
              >
                <span>{t.traces.session}:</span>
                <code className="font-mono text-primary">{selectedSessionId.slice(0, 8)}…</code>
              </span>
            )}
            {selectedSessionId && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={onCopyCurrentUrl}
                className="group"
                title={t.traces.copyShareableUrl}
              >
                <span>{t.traces.copyLink}</span>
                <Copy className="h-3.5 w-3.5 text-secondary group-hover:text-primary" />
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={onToggleSidebar}
            >
              {showSidebar ? t.traces.hideSessions : t.traces.showSessions}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="primary"
              onClick={onRefresh}
              disabled={loading}
            >
              {loading ? t.common.loading : t.common.refresh}
            </Button>
          </>
        )}
      />
    </div>
  );
}
