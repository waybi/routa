"use client";

/**
 * Two-line block reason for a card in the Blocked column (card 7fbfba57).
 * The board list drops `comments`, so a Blocked card is read once with
 * GET /api/tasks/<id>, keyed by id + updatedAt. Read-only; parsing is the same
 * function the "needs you" page uses.
 */

import { useEffect, useState } from "react";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { resolveApiPath } from "@/client/config/backend";
import type { TaskInfo } from "../types";
import { inboxReasonText, type InboxReasonText } from "../overview/inbox-rules";

type Comments = NonNullable<TaskInfo["comments"]>;

const loadedComments = new Map<string, Comments>();
const inflight = new Map<string, Promise<Comments | null>>();

function readComments(id: string, key: string): Promise<Comments | null> {
  const pending = inflight.get(key);
  if (pending) return pending;
  const request = desktopAwareFetch(resolveApiPath(`/tasks/${encodeURIComponent(id)}`), { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .then((json: { task?: { comments?: unknown } } | null) => {
      const comments = json?.task?.comments;
      if (!Array.isArray(comments)) return null;
      loadedComments.set(key, comments as Comments);
      return comments as Comments;
    })
    .catch(() => null)
    .finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
}

export function useBlockedReason(task: TaskInfo): InboxReasonText | null {
  const wanted = task.columnId === "blocked" && !task.lastSyncError?.trim() && !Array.isArray(task.comments);
  const key = `${task.id}|${task.updatedAt ?? ""}`;
  const [fetched, setFetched] = useState<{ key: string; comments: Comments } | null>(null);

  useEffect(() => {
    if (!wanted || loadedComments.has(key)) return undefined;
    let cancelled = false;
    void readComments(task.id, key).then((comments) => {
      if (!cancelled && comments) setFetched({ key, comments });
    });
    return () => {
      cancelled = true;
    };
  }, [wanted, key, task.id]);

  if (task.columnId !== "blocked") return null;
  const comments = task.comments ?? (fetched?.key === key ? fetched.comments : loadedComments.get(key));
  return inboxReasonText(task, comments);
}
