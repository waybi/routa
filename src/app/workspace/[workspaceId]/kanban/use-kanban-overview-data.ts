"use client";

/**
 * Data for the all-projects overview: tasks + boards per workspace, fetched
 * concurrently through the existing read endpoints, kept fresh by one
 * workspace-less SSE connection (server treats it as "*").
 *
 * - Each workspace has its own AbortController; a newer request aborts the
 *   older one, so the last request always wins. Aborts are not failures.
 * - `kanban:changed` / `kanban:task-lifecycle` refetch only the event's
 *   workspace (tasks only for `entity: "task"`), debounced like
 *   use-kanban-events.ts. A reconnect (second `connected`) refetches all.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { desktopAwareFetch, getDesktopApiBaseUrl } from "@/client/utils/diagnostics";
import { resolveApiPath } from "@/client/config/backend";
import { TASK_INVALIDATE_DEBOUNCE_MS, TASK_INVALIDATE_MAX_WAIT_MS } from "@/client/hooks/use-kanban-events";
import type { KanbanBoardInfo, TaskInfo } from "../types";
import type { OverviewWorkspace } from "./kanban-overview-rules";

export const OVERVIEW_RECONNECT_DELAY_MS = 3000;

export interface OverviewWorkspaceData {
  status: "loading" | "ready" | "error";
  tasks: TaskInfo[];
  boards: KanbanBoardInfo[];
}

interface InflightRequest {
  controller: AbortController;
  includeBoards: boolean;
}

interface PendingRefresh {
  timer: ReturnType<typeof setTimeout>;
  firstAt: number;
  includeBoards: boolean;
}

const EMPTY_DATA: OverviewWorkspaceData = { status: "loading", tasks: [], boards: [] };

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function fetchJson(path: string, signal: AbortSignal): Promise<Record<string, unknown>> {
  const response = await desktopAwareFetch(path, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

export function useKanbanOverviewData(workspaces: readonly OverviewWorkspace[]) {
  const [data, setData] = useState<Record<string, OverviewWorkspaceData>>({});
  const dataRef = useRef(data);
  const inflightRef = useRef(new Map<string, InflightRequest>());
  const pendingRef = useRef(new Map<string, PendingRefresh>());
  const workspaceIdsRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const loadWorkspace = useCallback(async (workspaceId: string, options: { boards: boolean }) => {
    const previous = inflightRef.current.get(workspaceId);
    // Aborting a pending full load must not lose its boards refetch.
    const includeBoards = options.boards || Boolean(previous?.includeBoards) || !dataRef.current[workspaceId];
    previous?.controller.abort();
    const controller = new AbortController();
    inflightRef.current.set(workspaceId, { controller, includeBoards });
    const query = `workspaceId=${encodeURIComponent(workspaceId)}`;
    try {
      const [tasksBody, boardsBody] = await Promise.all([
        fetchJson(`/api/tasks?${query}`, controller.signal),
        includeBoards ? fetchJson(`/api/kanban/boards?${query}`, controller.signal) : Promise.resolve(null),
      ]);
      if (controller.signal.aborted || !mountedRef.current) return;
      setData((current) => ({
        ...current,
        [workspaceId]: {
          status: "ready",
          tasks: Array.isArray(tasksBody.tasks) ? (tasksBody.tasks as TaskInfo[]) : [],
          boards: boardsBody
            ? (Array.isArray(boardsBody.boards) ? (boardsBody.boards as KanbanBoardInfo[]) : [])
            : (current[workspaceId]?.boards ?? []),
        },
      }));
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error) || !mountedRef.current) return;
      setData((current) => ({
        ...current,
        [workspaceId]: { ...(current[workspaceId] ?? EMPTY_DATA), status: "error" },
      }));
    } finally {
      if (inflightRef.current.get(workspaceId)?.controller === controller) {
        inflightRef.current.delete(workspaceId);
      }
    }
  }, []);

  const retry = useCallback((workspaceId: string) => {
    setData((current) => ({
      ...current,
      [workspaceId]: { ...(current[workspaceId] ?? EMPTY_DATA), status: "loading" },
    }));
    void loadWorkspace(workspaceId, { boards: true });
  }, [loadWorkspace]);

  const scheduleRefresh = useCallback((workspaceId: string, includeBoards: boolean) => {
    const pending = pendingRef.current.get(workspaceId);
    const now = Date.now();
    const firstAt = pending?.firstAt ?? now;
    if (pending) clearTimeout(pending.timer);
    const delay = Math.max(0, Math.min(TASK_INVALIDATE_DEBOUNCE_MS, TASK_INVALIDATE_MAX_WAIT_MS - (now - firstAt)));
    const merged = includeBoards || Boolean(pending?.includeBoards);
    const timer = setTimeout(() => {
      pendingRef.current.delete(workspaceId);
      void loadWorkspace(workspaceId, { boards: merged });
    }, delay);
    pendingRef.current.set(workspaceId, { timer, firstAt, includeBoards: merged });
  }, [loadWorkspace]);

  const workspaceKey = workspaces.map((workspace) => workspace.id).join("\n");

  // Initial load for every (new) workspace in the list.
  useEffect(() => {
    const ids = workspaceKey ? workspaceKey.split("\n") : [];
    workspaceIdsRef.current = new Set(ids);
    for (const id of ids) {
      if (!dataRef.current[id] && !inflightRef.current.has(id)) {
        void loadWorkspace(id, { boards: true });
      }
    }
  }, [workspaceKey, loadWorkspace]);

  // One workspace-less SSE connection while mounted.
  useEffect(() => {
    mountedRef.current = true;
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let connectedCount = 0;
    const inflight = inflightRef.current;
    const pending = pendingRef.current;

    const connect = () => {
      if (!mountedRef.current) return;
      const es = new EventSource(resolveApiPath("api/kanban/events", getDesktopApiBaseUrl()));
      source = es;
      es.onmessage = (event) => {
        if (source !== es) return;
        let payload: { type?: string; workspaceId?: string; entity?: string };
        try {
          payload = JSON.parse(event.data) as typeof payload;
        } catch {
          return;
        }
        if (payload.type === "connected") {
          connectedCount += 1;
          if (connectedCount > 1) {
            for (const id of workspaceIdsRef.current) void loadWorkspace(id, { boards: true });
          }
          return;
        }
        if (payload.type !== "kanban:changed" && payload.type !== "kanban:task-lifecycle") return;
        const workspaceId = payload.workspaceId;
        if (!workspaceId || !workspaceIdsRef.current.has(workspaceId)) return;
        scheduleRefresh(workspaceId, !(payload.type === "kanban:changed" && payload.entity === "task"));
      };
      es.onerror = () => {
        es.close();
        if (source !== es) return;
        source = null;
        if (!mountedRef.current) return;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, OVERVIEW_RECONNECT_DELAY_MS);
      };
    };

    connect();
    return () => {
      mountedRef.current = false;
      source?.close();
      source = null;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      for (const entry of pending.values()) clearTimeout(entry.timer);
      pending.clear();
      for (const entry of inflight.values()) entry.controller.abort();
      inflight.clear();
    };
  }, [loadWorkspace, scheduleRefresh]);

  return { data, retry };
}
