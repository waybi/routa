"use client";

import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw, SquarePen, Trash2 } from "lucide-react";

import { useTranslation } from "@/i18n";
import { useConfirm } from "@/client/components/confirm-dialog";
import { toast } from "@/client/components/toast";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { EmptyState, Skeleton } from "@/client/components/ui/states";
import { desktopAwareFetch } from "@/client/utils/diagnostics";

import { formatRelativeTime } from "./ui-components";
import type { SessionInfo } from "./types";

interface SessionsOverviewProps {
  sessions: SessionInfo[];
  workspaceId: string;
  onNavigate: (sessionId: string) => void;
  onRefresh: () => void;
  filterSession?: (session: SessionInfo & { parentSessionId?: string }) => boolean;
  /** Active search text; when set the list shows every match and the filter-empty state. */
  searchQuery?: string;
}

type RowError = { sessionId: string; message: string };

/** Case-insensitive match on the session name (or its fallback label) or a session-ID prefix. */
export function matchesSessionQuery(session: SessionInfo, query: string, fallbackLabel?: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const label = (session.name || fallbackLabel || "").toLowerCase();
  return label.includes(needle) || session.sessionId.toLowerCase().startsWith(needle);
}

function sessionLabel(session: SessionInfo): string {
  return session.name || session.provider || `Session ${session.sessionId.slice(0, 8)}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function SessionsOverview({
  sessions,
  workspaceId,
  onNavigate,
  onRefresh,
  filterSession,
  searchQuery = "",
}: SessionsOverviewProps) {
  const { t } = useTranslation();
  const copy = t.sessionsRedesign;
  const confirm = useConfirm();
  const [expanded, setExpanded] = useState(false);
  const [sessionTree, setSessionTree] = useState<Map<string, SessionInfo[]>>(new Map());
  const [loading, setLoading] = useState(false);
  const [renamingSession, setRenamingSession] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<RowError | null>(null);

  // Build parent-child tree when the full list is expanded.
  useEffect(() => {
    if (!expanded) return;

    setLoading(true);
    desktopAwareFetch(`/api/sessions?workspaceId=${encodeURIComponent(workspaceId)}&limit=100`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        const allSessions = Array.isArray(data?.sessions)
          ? (filterSession ? data.sessions.filter(filterSession) : data.sessions)
          : [];
        const tree = new Map<string, SessionInfo[]>();

        allSessions.forEach((session: SessionInfo & { parentSessionId?: string }) => {
          const parentId = session.parentSessionId || "root";
          if (!tree.has(parentId)) {
            tree.set(parentId, []);
          }
          tree.get(parentId)!.push(session);
        });

        tree.set("all", allSessions);
        setSessionTree(tree);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [expanded, filterSession, workspaceId]);

  const reportFailure = (sessionId: string, title: string, error: unknown) => {
    const message = errorText(error);
    setRowError({ sessionId, message: `${title}: ${message}` });
    toast.error(title, { description: message });
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (!(await confirm({ message: t.sessions.deleteConfirm, destructive: true }))) return;
    setPendingId(sessionId);
    setRowError(null);
    try {
      const res = await desktopAwareFetch(`/api/sessions/${sessionId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onRefresh();
    } catch (error) {
      reportFailure(sessionId, copy.deleteFailed, error);
    } finally {
      setPendingId(null);
    }
  };

  const handleRenameSession = (sessionId: string, currentName: string) => {
    setRenamingSession(sessionId);
    setRenameValue(currentName);
    setRowError(null);
  };

  const handleSaveRename = async (sessionId: string) => {
    if (renamingSession !== sessionId) return;
    const nextName = renameValue.trim();
    setRenamingSession(null);
    if (!nextName) return;
    setPendingId(sessionId);
    try {
      const res = await desktopAwareFetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nextName }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onRefresh();
    } catch (error) {
      reportFailure(sessionId, copy.renameFailed, error);
    } finally {
      setPendingId(null);
    }
  };

  const searching = searchQuery.trim().length > 0;
  const fullList = expanded && sessionTree.size > 0 ? (sessionTree.get("all") || []) : sessions;
  const displaySessions = searching
    ? fullList.filter((session) => matchesSessionQuery(session, searchQuery, sessionLabel(session)))
    : expanded
      ? fullList
      : sessions.slice(0, 6);

  const renderSession = (session: SessionInfo, depth = 0) => {
    const children = expanded && !searching ? (sessionTree.get(session.sessionId) || []) : [];
    const isRenaming = renamingSession === session.sessionId;
    const isPending = pendingId === session.sessionId;
    const label = sessionLabel(session);
    const error = rowError?.sessionId === session.sessionId ? rowError.message : null;

    return (
      <li key={session.sessionId} data-testid="session-row" style={depth ? { marginLeft: depth * 20 } : undefined}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-default px-4 py-3 hover:bg-hover">
          {depth > 0 ? <ChevronRight className="h-3 w-3 shrink-0 text-secondary" aria-hidden="true" /> : null}
          <div className="min-w-0 flex-1 basis-60">
            {isRenaming ? (
              <input
                type="text"
                value={renameValue}
                aria-label={copy.renameAction}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSaveRename(session.sessionId);
                  if (e.key === "Escape") setRenamingSession(null);
                }}
                onBlur={() => void handleSaveRename(session.sessionId)}
                autoFocus
                className="w-full rounded-control border border-accent bg-surface px-2 py-1 text-[13px] font-medium text-primary outline-none"
              />
            ) : (
              <h3 className="m-0 break-words text-[13px] font-semibold text-primary">{label}</h3>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-secondary">
              <code className="font-mono text-[11px] text-secondary" title={session.sessionId}>
                {session.sessionId.slice(0, 8)}
              </code>
              {session.provider ? <Badge>{session.provider}</Badge> : null}
              {session.role ? <Badge tone="info">{session.role}</Badge> : null}
              {children.length > 0 ? <Badge>{`${copy.childSessions} ${children.length}`}</Badge> : null}
            </div>
            {error ? (
              <p role="alert" data-testid="session-row-error" className="m-0 mt-1.5 text-[11px] text-danger">
                {error}
              </p>
            ) : null}
          </div>
          <span className="shrink-0 font-mono text-[11px] text-secondary">{formatRelativeTime(session.createdAt)}</span>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button variant="secondary" size="sm" onClick={() => onNavigate(session.sessionId)}>
              {copy.openSessionAction}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={isPending}
              onClick={() => handleRenameSession(session.sessionId, label)}
              aria-label={`${copy.renameAction} ${label}`}
              title={copy.renameAction}
            >
              <SquarePen className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              loading={isPending}
              onClick={() => void handleDeleteSession(session.sessionId)}
              aria-label={`${copy.deleteAction} ${label}`}
              title={isPending ? copy.deleting : copy.deleteAction}
              className="hover:text-danger"
            >
              {isPending ? null : <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
            </Button>
          </div>
        </div>
        {children.length > 0 ? <ul className="m-0 list-none p-0">{children.map((child) => renderSession(child, depth + 1))}</ul> : null}
      </li>
    );
  };

  return (
    <section className="overflow-hidden rounded-lg border border-default bg-surface" aria-label={copy.sessionListLabel}>
      <div className="flex items-center justify-between gap-3 border-b border-default px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="m-0 text-[15px] font-semibold text-primary">{t.sessions.recentSessions}</h2>
          <Badge>{String(sessions.length)}</Badge>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={onRefresh} title={t.common.refresh} aria-label={t.common.refresh}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
            {expanded ? t.sessions.showLess : t.sessions.showAll}
            <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
          </Button>
        </div>
      </div>
      {loading ? (
        <Skeleton lines={3} label={copy.loadingSessions} className="p-4" />
      ) : displaySessions.length === 0 ? (
        <div className="p-4">
          {searching ? (
            <EmptyState title={copy.filterEmptyTitle} description={copy.filterEmptyDescription} />
          ) : (
            <EmptyState title={copy.emptyTitle} description={copy.emptyDescription} />
          )}
        </div>
      ) : (
        <ul className="m-0 list-none p-0">{displaySessions.map((session) => renderSession(session))}</ul>
      )}
    </section>
  );
}
