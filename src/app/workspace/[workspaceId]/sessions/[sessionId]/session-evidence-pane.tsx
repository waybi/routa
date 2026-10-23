"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import type { SessionKanbanContext } from "@/client/types/kanban-context";
import { Badge } from "@/client/components/ui/badge";
import { EmptyState, ErrorState, Skeleton } from "@/client/components/ui/states";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { useTranslation } from "@/i18n";

import { KanbanCardArtifacts } from "../../kanban/kanban-card-artifacts";
import { collectChangedFiles, type SessionTracesState } from "./use-session-traces";

/** What the page already knows about the session's linked card. */
export interface KnownSessionContext {
  sessionId: string;
  kanbanContext: SessionKanbanContext | null;
}

export interface SessionEvidencePaneProps {
  sessionId: string;
  workspaceId: string;
  /** True once the evidence tab has been opened; nothing is read before. */
  opened: boolean;
  /** Context already read by the right sidebar; reused instead of a second GET. */
  knownContext?: KnownSessionContext | null;
  traces: SessionTracesState;
}

type ContextState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; kanbanContext: SessionKanbanContext | null }
  | { status: "error"; message: string };

export function buildCardChangesHref(workspaceId: string, context: SessionKanbanContext): string {
  const params = new URLSearchParams();
  if (context.boardId) params.set("boardId", context.boardId);
  params.set("taskId", context.taskId);
  params.set("detailTab", "changes");
  return `/workspace/${encodeURIComponent(workspaceId)}/kanban?${params.toString()}`;
}

/**
 * `GET /api/sessions/<id>/context` can write a playbook file into the
 * session cwd, so it is read at most once here, only after the tab opens,
 * and only when the sidebar has not read it already.
 */
function useEvidenceContext(sessionId: string, opened: boolean, known: KnownSessionContext | null | undefined) {
  const knownForSession = known && known.sessionId === sessionId ? known : null;
  const hasKnown = Boolean(knownForSession);
  const [own, setOwn] = useState<{ sessionId: string; state: ContextState }>({ sessionId, state: { status: "idle" } });
  const [nonce, setNonce] = useState(0);
  const readKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!opened || hasKnown || !sessionId) return;
    const key = `${sessionId}:${nonce}`;
    if (readKeyRef.current === key) return;
    readKeyRef.current = key;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading state for a request started by this effect
    setOwn({ sessionId, state: { status: "loading" } });
    // No cancel flag: the read is gated by readKeyRef, so a StrictMode
    // re-run must not drop its result. Results for another session are ignored.
    const apply = (state: ContextState) =>
      setOwn((prev) => (prev.sessionId === sessionId ? { sessionId, state } : prev));
    desktopAwareFetch(`/api/sessions/${encodeURIComponent(sessionId)}/context`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        return (data?.kanbanContext ?? null) as SessionKanbanContext | null;
      })
      .then((kanbanContext) => apply({ status: "ready", kanbanContext }))
      .catch((error: unknown) => apply({ status: "error", message: error instanceof Error ? error.message : String(error) }));
  }, [hasKnown, nonce, opened, sessionId]);

  const retry = useCallback(() => setNonce((value) => value + 1), []);

  if (knownForSession) {
    return { state: { status: "ready", kanbanContext: knownForSession.kanbanContext } as ContextState, retry };
  }
  return { state: own.sessionId === sessionId ? own.state : ({ status: "idle" } as ContextState), retry };
}

export function SessionEvidencePane({ sessionId, workspaceId, opened, knownContext, traces }: SessionEvidencePaneProps) {
  const { t } = useTranslation();
  const copy = t.sessionDetailRedesign.evidence;
  const { state: contextState, retry: retryContext } = useEvidenceContext(sessionId, opened, knownContext);
  const changedFiles = collectChangedFiles(traces.traces);

  const contextReady = contextState.status === "ready";
  const tracesReady = traces.status === "ready";
  const card = contextReady ? contextState.kanbanContext : null;
  const noCard = contextReady && !card;
  const noFiles = tracesReady && changedFiles.length === 0;
  const loading = !contextReady && contextState.status !== "error";

  const retryAll = () => {
    if (contextState.status === "error") retryContext();
    if (traces.status === "error") traces.reload();
  };
  const errorMessage = contextState.status === "error" ? contextState.message : traces.status === "error" ? traces.error : null;

  return (
    <div data-testid="session-evidence-pane" className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto px-4 py-4 md:px-[22px]">
      {errorMessage ? (
        <ErrorState title={copy.errorTitle} message={errorMessage} onRetry={retryAll} retryLabel={copy.retry} />
      ) : null}

      {loading ? <Skeleton lines={3} label={copy.loading} /> : null}

      {noCard && noFiles ? (
        <EmptyState title={copy.emptyTitle} description={copy.emptyDescription} />
      ) : (
        <>
          {card ? (
            <section data-testid="session-evidence-card" aria-label={copy.linkedCardTitle} className="rounded-lg border border-default bg-surface p-4">
              <p className="m-0 text-xs text-secondary">{copy.linkedCardTitle}</p>
              <h2 className="m-0 mt-1 break-words text-[15px] font-semibold text-primary">{card.taskTitle}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge className="font-mono">
                  <span className="sr-only">{copy.cardIdLabel} </span>
                  <span title={card.taskId}>{card.taskId.slice(0, 8)}</span>
                </Badge>
                {card.columnId ? (
                  <Badge tone="info">
                    <span>{copy.columnLabel}</span>
                    <span>{card.columnId}</span>
                  </Badge>
                ) : null}
              </div>
              <Link
                href={buildCardChangesHref(workspaceId, card)}
                data-testid="session-evidence-card-link"
                className="mt-3 inline-flex text-xs text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
              >
                {copy.openCardChanges}
              </Link>
              <div className="mt-4">
                <p className="m-0 mb-2 text-xs font-semibold text-primary">{copy.artifactsTitle}</p>
                <KanbanCardArtifacts taskId={card.taskId} compact />
              </div>
            </section>
          ) : noCard ? (
            <p data-testid="session-evidence-no-card" className="m-0 rounded-lg border border-dashed border-default px-4 py-3 text-xs text-secondary">
              {copy.noLinkedCard}
            </p>
          ) : null}

          {tracesReady || changedFiles.length > 0 ? (
            <section data-testid="session-evidence-files" aria-label={copy.changedFilesTitle}>
              <p className="m-0 mb-2 text-xs font-semibold text-primary">{copy.changedFilesTitle}</p>
              {changedFiles.length > 0 ? (
                <ul className="m-0 list-none divide-y divide-default rounded-lg border border-default bg-surface p-0">
                  {changedFiles.map((path) => (
                    <li key={path} data-testid="session-evidence-file" className="break-all px-3 py-2 font-mono text-[11px] text-primary">
                      {path}
                    </li>
                  ))}
                </ul>
              ) : (
                <p data-testid="session-evidence-no-files" className="m-0 rounded-lg border border-dashed border-default px-4 py-3 text-xs text-secondary">
                  {copy.noChangedFiles}
                </p>
              )}
            </section>
          ) : traces.status !== "error" ? (
            <Skeleton lines={2} label={copy.loading} />
          ) : null}
        </>
      )}
    </div>
  );
}
