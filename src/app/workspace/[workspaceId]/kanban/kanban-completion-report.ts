/**
 * Completion report helpers for the kanban card detail.
 *
 * Recognition of a completion report note lives in `@/core/kanban/completion-report`
 * so the server (update_card dedupe) and this UI use the same rule.
 */

import { isCompletionReportNote } from "@/core/kanban/completion-report";

export { isCompletionReportNote };

export interface CompletionReportSplit<T> {
  /** Notes that are not completion reports, in original order. */
  progressNotes: T[];
  /** Completion reports, newest first. */
  completionReports: T[];
}

export function splitCompletionReports<T extends { body: string; createdAt?: string }>(
  entries: T[],
): CompletionReportSplit<T> {
  const progressNotes: T[] = [];
  const reports: Array<{ entry: T; index: number }> = [];
  entries.forEach((entry, index) => {
    if (isCompletionReportNote(entry.body)) {
      reports.push({ entry, index });
    } else {
      progressNotes.push(entry);
    }
  });
  reports.sort((a, b) => {
    const ta = a.entry.createdAt ? Date.parse(a.entry.createdAt) : NaN;
    const tb = b.entry.createdAt ? Date.parse(b.entry.createdAt) : NaN;
    if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) return tb - ta;
    return b.index - a.index;
  });
  return { progressNotes, completionReports: reports.map((r) => r.entry) };
}
