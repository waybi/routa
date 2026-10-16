import { v4 as uuidv4 } from "uuid";
import type { TaskCommentEntry } from "../models/task";
import { isCompletionReportNote } from "./completion-report";

export function appendTaskComment(existing: string | undefined, next: string): string {
  const trimmedNext = next.trim();
  if (!trimmedNext) {
    return existing ?? "";
  }

  const trimmedExisting = existing?.trim();
  return trimmedExisting ? `${trimmedExisting}\n\n${trimmedNext}` : trimmedNext;
}

export function appendTaskCommentEntry(
  existing: TaskCommentEntry[] | undefined,
  next: string,
  metadata?: { agentId?: string; sessionId?: string; source?: TaskCommentEntry["source"] },
): TaskCommentEntry[] {
  const trimmedNext = next.trim();
  if (!trimmedNext) {
    return existing ?? [];
  }

  const source = metadata && Object.prototype.hasOwnProperty.call(metadata, "source")
    ? metadata.source
    : "update_card";

  return [
    ...(existing ?? []),
    {
      id: uuidv4(),
      body: trimmedNext,
      createdAt: new Date().toISOString(),
      source,
      agentId: metadata?.agentId,
      sessionId: metadata?.sessionId,
    },
  ];
}

/**
 * Like appendTaskCommentEntry, but a card keeps at most one completion report
 * ("## 完成汇报" / "## Completion Summary" ...). When the new note is a report
 * and the card already has one, the newest existing report is rewritten in
 * place (same id, new body/createdAt/agentId/sessionId) so a re-run Done lane
 * reporter replaces its earlier conclusion instead of stacking another copy.
 * Older duplicate reports already on the card are left untouched.
 */
export function upsertTaskCommentEntry(
  existing: TaskCommentEntry[] | undefined,
  next: string,
  metadata?: { agentId?: string; sessionId?: string; source?: TaskCommentEntry["source"] },
): TaskCommentEntry[] {
  const trimmedNext = next.trim();
  if (!trimmedNext || !isCompletionReportNote(trimmedNext)) {
    return appendTaskCommentEntry(existing, next, metadata);
  }

  const entries = existing ?? [];
  let reportIndex = -1;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (isCompletionReportNote(entries[index].body)) {
      reportIndex = index;
      break;
    }
  }
  if (reportIndex < 0) {
    return appendTaskCommentEntry(existing, next, metadata);
  }

  const updated: TaskCommentEntry = {
    ...entries[reportIndex],
    body: trimmedNext,
    createdAt: new Date().toISOString(),
    agentId: metadata?.agentId,
    sessionId: metadata?.sessionId,
  };
  return entries.map((entry, index) => (index === reportIndex ? updated : entry));
}
