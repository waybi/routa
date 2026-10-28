"use client";

/**
 * Comments for the reason fallback of Blocked rows without lastSyncError
 * (card 4877583c). GET /api/tasks drops `comments` from its list projection,
 * so for each such row the card is read once with GET /api/tasks/<id>
 * (keyed by id + updatedAt, so a changed card is read again). Read-only.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { resolveApiPath } from "@/client/config/backend";
import type { TaskInfo } from "../types";
import type { InboxRow } from "./inbox-rules";

type Comments = NonNullable<TaskInfo["comments"]>;

function commentsKey(task: Pick<TaskInfo, "id" | "updatedAt">): string {
  return `${task.id}|${task.updatedAt ?? ""}`;
}

/** Rows that need the detail read: blockedUnknown and no comments on the list copy. */
export function rowsNeedingComments(rows: ReadonlyArray<Pick<InboxRow, "reason" | "task">>): Array<{ id: string; key: string }> {
  const seen = new Set<string>();
  const wanted: Array<{ id: string; key: string }> = [];
  for (const row of rows) {
    if (row.reason !== "blockedUnknown" || Array.isArray(row.task.comments)) continue;
    const key = commentsKey(row.task);
    if (seen.has(key)) continue;
    seen.add(key);
    wanted.push({ id: row.task.id, key });
  }
  return wanted;
}

export function useInboxReasonComments(rows: ReadonlyArray<Pick<InboxRow, "reason" | "task">>): (task: TaskInfo) => Comments | undefined {
  const [loaded, setLoaded] = useState<ReadonlyMap<string, Comments>>(() => new Map());
  const [requested] = useState(() => new Set<string>());
  const wantedJson = JSON.stringify(rowsNeedingComments(rows));
  const wanted = useMemo(() => JSON.parse(wantedJson) as Array<{ id: string; key: string }>, [wantedJson]);

  useEffect(() => {
    for (const { id, key } of wanted) {
      if (requested.has(key)) continue;
      requested.add(key);
      void desktopAwareFetch(resolveApiPath(`/tasks/${encodeURIComponent(id)}`), { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((json: { task?: { comments?: unknown } } | null) => {
          const comments = json?.task?.comments;
          if (Array.isArray(comments)) setLoaded((current) => new Map(current).set(key, comments as Comments));
        })
        .catch(() => {
          // Keep "reason not recorded"; the row stays usable.
        });
    }
  }, [requested, wanted]);

  return useCallback((task: TaskInfo) => task.comments ?? loaded.get(commentsKey(task)), [loaded]);
}
