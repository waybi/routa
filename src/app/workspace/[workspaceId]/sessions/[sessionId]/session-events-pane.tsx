"use client";

import Link from "next/link";

import { Badge } from "@/client/components/ui/badge";
import { EmptyState, ErrorState, Skeleton } from "@/client/components/ui/states";
import { useTranslation } from "@/i18n";

import { formatRelativeTime } from "../../ui-components";
import {
  SESSION_TRACE_LIMIT,
  isTraceListTruncated,
  summarizeEventFiles,
  type SessionTracesState,
} from "./use-session-traces";

export interface SessionEventsPaneProps {
  workspaceId: string;
  traces: SessionTracesState;
}

/**
 * Events tab (design-spec §3 row 6): the session's trace records, oldest
 * first. "Not read yet", "read failed" and "read, zero records" are three
 * different screens; a failed reload keeps the rows already on screen.
 */
export function SessionEventsPane({ workspaceId, traces }: SessionEventsPaneProps) {
  const { t } = useTranslation();
  const copy = t.sessionDetailRedesign.events;
  const rows = traces.traces ?? [];
  const tracesHref = `/traces?workspaceId=${encodeURIComponent(workspaceId)}`;

  return (
    <div data-testid="session-events-pane" className="flex h-full min-h-0 flex-col overflow-y-auto px-4 py-4 md:px-[22px]">
      {traces.status === "error" ? (
        <ErrorState
          title={copy.errorTitle}
          message={traces.error}
          onRetry={traces.reload}
          retryLabel={copy.retry}
          className="mb-4"
        />
      ) : null}

      {(traces.status === "idle" || traces.status === "loading") && rows.length === 0 ? (
        <Skeleton lines={4} label={copy.loading} />
      ) : null}

      {traces.status === "ready" && rows.length === 0 ? (
        <EmptyState title={copy.emptyTitle} description={copy.emptyDescription} />
      ) : null}

      {rows.length > 0 ? (
        <>
          {isTraceListTruncated(rows) ? (
            <p data-testid="session-events-truncated" className="m-0 mb-3 text-xs text-secondary">
              {copy.truncated.replace("{count}", String(SESSION_TRACE_LIMIT))}
            </p>
          ) : null}
          <ol aria-label={copy.listLabel} className="m-0 list-none divide-y divide-default rounded-lg border border-default bg-surface p-0">
            {rows.map((row, index) => {
              const files = summarizeEventFiles(row.files);
              const typeLabel = copy.types[row.eventType] ?? row.eventType;
              return (
                <li key={row.id || `${row.timestamp}-${index}`} data-testid="session-event-row" className="grid gap-1 px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium text-primary">{typeLabel}</span>
                    {row.tool?.name ? (
                      <Badge>
                        <span className="font-mono">{row.tool.name}</span>
                        {row.tool.status ? <span className="text-secondary">· {row.tool.status}</span> : null}
                      </Badge>
                    ) : null}
                    <time
                      dateTime={row.timestamp}
                      title={new Date(row.timestamp).toLocaleString()}
                      className="ml-auto shrink-0 font-mono text-[11px] text-secondary"
                    >
                      {formatRelativeTime(row.timestamp)}
                    </time>
                  </div>
                  {files.shown.length > 0 ? (
                    <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-0.5 p-0 text-[11px] text-secondary">
                      {files.shown.map((path) => (
                        <li key={path} data-testid="session-event-file" className="min-w-0 break-all font-mono">{path}</li>
                      ))}
                      {files.more > 0 ? (
                        <li data-testid="session-event-more-files">{copy.moreFiles.replace("{count}", String(files.more))}</li>
                      ) : null}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </>
      ) : null}

      <div className="mt-4">
        <Link href={tracesHref} data-testid="session-events-open-traces" className="text-xs text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent">
          {copy.openInTraces}
        </Link>
      </div>
    </div>
  );
}
