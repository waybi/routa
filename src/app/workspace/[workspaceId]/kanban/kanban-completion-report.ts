/**
 * Completion report helpers for the kanban card detail.
 *
 * Recognition and newest-first ordering live in `@/core/kanban/completion-report`
 * so the server (update_card dedupe, list projection summary) and this UI use
 * the same rule.
 */

export {
  isCompletionReportNote,
  splitCompletionReports,
  type CompletionReportSplit,
} from "@/core/kanban/completion-report";
