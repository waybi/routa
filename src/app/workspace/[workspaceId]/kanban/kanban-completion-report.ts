/**
 * Completion report helpers for the kanban card detail.
 *
 * The Done-lane reporter (kanban-done-reporter) writes its final summary as a
 * card note via update_card. Notes carry no specialist id, so the report is
 * recognised by its first line: a heading or bracketed title that names the
 * completion report ("完成汇报" / "完工汇报" / "Completion Summary" / ...).
 */

const COMPLETION_REPORT_TITLE =
  /^\s*(?:#{1,6}\s*|[【[]\s*)?(?:完成汇报|完工汇报|完成总结|完工总结|completion\s+(?:summary|report))/i;

export function isCompletionReportNote(body: string | undefined | null): boolean {
  if (!body) return false;
  const firstLine = body.split("\n").find((line) => line.trim().length > 0) ?? "";
  return COMPLETION_REPORT_TITLE.test(firstLine);
}

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
