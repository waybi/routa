/**
 * Completion report recognition shared by the server and the card detail UI.
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
