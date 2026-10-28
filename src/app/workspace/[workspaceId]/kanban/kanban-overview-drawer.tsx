"use client";

/**
 * Right-side card drawer of the all-projects overview. It opens with the data
 * the list already has, then reads the one card (GET /api/tasks/<id>) for the
 * full requirement. A failed read keeps the list data and shows a notice.
 * Esc and the scrim close it; the overview puts focus back on the card row.
 */

import React, { useEffect, useId, useRef, useState } from "react";
import { ExternalLink, X } from "lucide-react";
import { Badge } from "@/client/components/ui/badge";
import { buttonClassName } from "@/client/components/ui/button";
import { Skeleton } from "@/client/components/ui/states";
import { MarkdownViewer } from "@/client/components/markdown/markdown-viewer";
import { resolveApiPath } from "@/client/config/backend";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { useTranslation } from "@/i18n";
import type { TaskInfo } from "../types";
import { formatSpan } from "./kanban-overview-format";

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';
const MAX_RUNS = 40;

type DetailState = { phase: "loading" } | { phase: "ready"; task: TaskInfo } | { phase: "error" };

function useCardDetail(taskId: string): DetailState {
  const [state, setState] = useState<DetailState>({ phase: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    desktopAwareFetch(resolveApiPath(`/tasks/${encodeURIComponent(taskId)}`), { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((json: { task?: TaskInfo } | null) => {
        if (controller.signal.aborted) return;
        setState(json?.task ? { phase: "ready", task: json.task } : { phase: "error" });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ phase: "error" });
      });
    return () => controller.abort();
  }, [taskId]);
  return state;
}

export function KanbanOverviewDrawer({
  task,
  projectTitle,
  columnLabel,
  onClose,
  onOpenInBoard,
}: {
  task: TaskInfo;
  projectTitle: string;
  columnLabel: string;
  onClose: () => void;
  onOpenInBoard: () => void;
}) {
  const { t } = useTranslation();
  const copy = t.kanbanOverview;
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const detail = useCardDetail(task.id);
  const shown = detail.phase === "ready" ? { ...task, ...detail.task } : task;

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  // Capture phase: Esc closes the drawer before the search box (or anything else) can see it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || !panelRef.current) return;
    const focusables = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusables.length === 0) return;
    const index = focusables.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey
      ? (index <= 0 ? focusables.length - 1 : index - 1)
      : (index === -1 || index >= focusables.length - 1 ? 0 : index + 1);
    event.preventDefault();
    focusables[next].focus();
  };

  const runs = [...(shown.laneSessions ?? [])].reverse().slice(0, MAX_RUNS);
  return (
    <div className="fixed inset-0 z-40" onKeyDown={onKeyDown}>
      <div
        className="absolute inset-0 bg-canvas/70 backdrop-blur-[2px] transition-opacity duration-200 starting:opacity-0 motion-reduce:transition-none"
        onClick={onClose}
        aria-hidden="true"
        data-testid="kanban-overview-drawer-scrim"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="kanban-overview-drawer"
        className="absolute right-0 top-0 flex h-full w-[min(880px,100vw)] flex-col border-l border-default bg-surface shadow-overlay transition-transform duration-200 ease-out starting:translate-x-full motion-reduce:transition-none"
      >
        <div className="flex items-start gap-3 border-b border-default px-5 py-[18px]">
          <div className="min-w-0 flex-1">
            <p className="m-0 truncate text-[11px] text-secondary">
              {projectTitle} · <span className="font-mono">{task.id.slice(0, 8)}</span> · {columnLabel}
            </p>
            <h2 id={titleId} className="m-0 mt-0.5 break-words text-base font-semibold text-primary" data-testid="kanban-overview-drawer-title">{shown.title}</h2>
          </div>
          <button type="button" onClick={onOpenInBoard} className={buttonClassName("secondary", "sm")} data-testid="kanban-overview-drawer-open">
            {copy.openInBoard}
            <ExternalLink className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={copy.drawerClose}
            title={copy.drawerClose}
            className={buttonClassName("ghost", "sm")}
            data-testid="kanban-overview-drawer-close"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="flex flex-1 flex-col gap-4 overflow-auto px-5 py-[18px] text-[12px]">
          {detail.phase === "error" && (
            <p className="m-0" role="alert" data-testid="kanban-overview-drawer-error"><Badge tone="danger">{copy.drawerLoadFailed}</Badge></p>
          )}
          {shown.completionReport?.excerpt && (
            <section>
              <h3 className="m-0 mb-1 text-[11px] font-semibold text-secondary">{copy.drawerReport}</h3>
              <p className="m-0 whitespace-pre-wrap break-words text-primary">{shown.completionReport.excerpt}</p>
            </section>
          )}
          <section>
            <h3 className="m-0 mb-1 text-[11px] font-semibold text-secondary">{copy.drawerObjective}</h3>
            {detail.phase === "loading" && !shown.objective
              ? <Skeleton lines={3} label={copy.drawerLoading} />
              : shown.objective ? <MarkdownViewer content={shown.objective} hideCanonicalStory /> : null}
          </section>
          <section>
            <h3 className="m-0 mb-1 text-[11px] font-semibold text-secondary">{copy.drawerRuns}</h3>
            {runs.length === 0 ? <p className="m-0 text-secondary">{copy.drawerNoRuns}</p> : (
              <ul className="m-0 list-none space-y-0.5 p-0" data-testid="kanban-overview-drawer-runs">
                {runs.map((run) => {
                  const end = Date.parse(run.completedAt ?? run.lastActivityAt ?? "");
                  const start = Date.parse(run.startedAt);
                  return (
                    <li key={run.sessionId} className="flex gap-2 text-primary">
                      <span className="w-20 shrink-0 text-secondary">{run.columnName ?? run.columnId}</span>
                      <span className="min-w-0 flex-1 truncate">{run.specialistName ?? run.stepName ?? run.role ?? ""}</span>
                      <span className={`shrink-0 ${run.status === "failed" || run.status === "timed_out" ? "text-danger" : "text-secondary"}`}>{run.status}</span>
                      {Number.isFinite(end) && Number.isFinite(start) && end > start && <span className="shrink-0 font-mono text-secondary">{formatSpan(end - start, copy)}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
