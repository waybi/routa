/**
 * Completion report recognition shared by the server and the card detail UI.
 *
 * The Done-lane reporter (kanban-done-reporter) writes its final summary as a
 * card note via update_card. Notes carry no specialist id, so the report is
 * recognised by its first line: a heading or bracketed title that names the
 * completion report ("完成汇报" / "完工汇报" / "Completion Summary" / ...).
 *
 * The list projection also needs a one-line summary of the newest report
 * (`summarizeTaskCompletionReport`). The Rust backend mirrors these rules in
 * `crates/routa-server/src/api/tasks/completion_report.rs`; both sides are
 * pinned by `__fixtures__/completion-report-summary-cases.json`.
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

/**
 * Splits notes into progress notes and completion reports (newest first).
 * Newest = largest parseable `createdAt`; ties or unparseable times fall back
 * to the later position in the input.
 */
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

/** The newest completion report, chosen exactly like `splitCompletionReports`. */
export function pickLatestCompletionReport<T extends { body: string; createdAt?: string }>(
  entries: T[],
): T | null {
  return splitCompletionReports(entries).completionReports[0] ?? null;
}

export interface CompletionReportSummary {
  excerpt: string | null;
  commit: string | null;
  hasLeftover: boolean;
  createdAt: string;
}

export const COMPLETION_EXCERPT_MAX_CHARS = 120;

// Label line: optional list marker, heading marks, bold, ⚠️, and a Chinese
// ordinal ("一、") before the label; optional bold and a colon after it.
// Groups: 1 heading marks, 2 bold before ordinal, 3 bold before label,
// 4 label, 5 colon, 6 inline text. Keep in sync with the Rust mirror.
const LABEL_PREFIX = String.raw`^\s*(?:[-*+]\s+)?(#{1,6}\s*)?(?:(\*\*)\s*)?(?:⚠\uFE0F?\s*)?(?:[一二三四五六七八九十]+[、.．]\s*)?(?:(\*\*)\s*)?`;
const LABEL_SUFFIX = String.raw`\s*(?:\*\*\s*)?(?:([:：])\s*(.*?))?\s*$`;
const SHIPPED_LABEL = new RegExp(`${LABEL_PREFIX}(交付内容|完成内容|what\\s+shipped)${LABEL_SUFFIX}`, "i");
const LEFTOVER_LABEL = new RegExp(`${LABEL_PREFIX}((?:遗留|未完成)[^:：*\\s|]{0,12}?)${LABEL_SUFFIX}`, "i");
const LEFTOVER_BASE_LABELS = new Set(["遗留", "遗留说明", "遗留事项", "遗留风险", "未完成"]);
const MAINLINE_LABEL = /^\s*(?:[-*+]\s+)?(?:\*\*\s*)?(?:主干提交号|mainline\s+commit)(.*)$/i;
const HEADING = /^\s*(#{1,6})(?:[^#]|$)/;
const BOLD_LIST_LABEL = /^(\s*)(?:[-*+]\s+)?\*\*[^*]+?\*\*/;
const LEADING_WHITESPACE = /^\s*/;
const SENTENCE_END = new Set(["。", "！", "？", "!", "?"]);
const NO_LEFTOVER_VALUES = new Set(["无", "没有", "无遗留", "暂无", "none", "n/a"]);

interface LabelMatch {
  headingLevel: number | null;
  inline: string;
}

function matchLabel(line: string, pattern: RegExp, leftover: boolean): LabelMatch | null {
  const m = pattern.exec(line);
  if (!m) return null;
  const heading = m[1];
  const bold = Boolean(m[2] || m[3]);
  const colon = Boolean(m[5]);
  if (leftover && !colon && !heading && !bold && !LEFTOVER_BASE_LABELS.has(m[4])) {
    return null;
  }
  return {
    headingLevel: heading ? heading.trim().length : null,
    inline: m[6] ?? "",
  };
}

/** Drops markdown decoration: link targets, leading list marker, # * _ ` >. */
export function stripCompletionMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/[#*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstSentence(text: string): string {
  const chars = Array.from(text);
  const end = chars.findIndex((char) => SENTENCE_END.has(char));
  return end === -1 ? text : chars.slice(0, end + 1).join("");
}

function finalizeExcerpt(raw: string): string | null {
  // Link targets go first so a "?" inside a URL cannot end the sentence.
  const cleaned = stripCompletionMarkdown(firstSentence(raw.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")));
  if (!cleaned) return null;
  const chars = Array.from(cleaned);
  if (chars.length <= COMPLETION_EXCERPT_MAX_CHARS) return cleaned;
  return `${chars.slice(0, COMPLETION_EXCERPT_MAX_CHARS - 1).join("")}…`;
}

function extractExcerpt(lines: string[]): string | null {
  for (let i = 0; i < lines.length; i += 1) {
    const label = matchLabel(lines[i], SHIPPED_LABEL, false);
    if (!label) continue;
    if (stripCompletionMarkdown(label.inline)) return finalizeExcerpt(label.inline);
    const next = lines.slice(i + 1).find((line) => line.trim() && !/^\s*#/.test(line));
    return next ? finalizeExcerpt(next) : null;
  }
  const fallback = lines.find((line) => line.trim() && !/^\s*#/.test(line) && !isCompletionReportNote(line));
  return fallback ? finalizeExcerpt(fallback) : null;
}

/**
 * Only the word right after the label counts. Real "not pushed" reports go on
 * to mention rebase bases and local commits on the same line ("未推送……rebase
 * 到 origin/main 32c71e35"); taking any later hash would report a commit that
 * is not on mainline.
 */
function extractMainlineCommit(lines: string[]): string | null {
  for (const line of lines) {
    const m = MAINLINE_LABEL.exec(line);
    if (!m) continue;
    const token = /^[\s*:：`]*([0-9A-Za-z]+)/.exec(m[1])?.[1] ?? "";
    if (token.length >= 7 && token.length <= 40 && /^[0-9a-f]+$/i.test(token) && /[a-f]/i.test(token)) {
      return token.slice(0, 8).toLowerCase();
    }
    return null;
  }
  return null;
}

function isEmptyLeftover(content: string): boolean {
  const value = stripCompletionMarkdown(content).replace(/[。.!！?？;；]+$/, "").trim().toLowerCase();
  return !value || NO_LEFTOVER_VALUES.has(value);
}

function detectLeftover(lines: string[]): boolean {
  for (let i = 0; i < lines.length; i += 1) {
    const label = matchLabel(lines[i], LEFTOVER_LABEL, true);
    if (!label) continue;
    const indent = (LEADING_WHITESPACE.exec(lines[i])?.[0] ?? "").length;
    const parts = [label.inline];
    for (const line of lines.slice(i + 1)) {
      const heading = HEADING.exec(line);
      if (heading && (label.headingLevel === null || heading[1].length <= label.headingLevel)) break;
      const bold = label.headingLevel === null ? BOLD_LIST_LABEL.exec(line) : null;
      if (bold && bold[1].length <= indent) break;
      parts.push(line);
    }
    if (!isEmptyLeftover(parts.join(" "))) return true;
  }
  return false;
}

/** Summarises one completion report body (excerpt / mainline commit / leftover flag). */
export function summarizeCompletionReport(body: string, createdAt: string): CompletionReportSummary {
  const lines = body.split("\n");
  return {
    excerpt: extractExcerpt(lines),
    commit: extractMainlineCommit(lines),
    hasLeftover: detectLeftover(lines),
    createdAt,
  };
}

/** Summary of the newest completion report among hydrated task comments, or null. */
export function summarizeTaskCompletionReport(
  entries: Array<{ body?: string; createdAt?: string }>,
): CompletionReportSummary | null {
  const normalized = entries.map((entry) => ({ body: entry.body ?? "", createdAt: entry.createdAt ?? "" }));
  const latest = pickLatestCompletionReport(normalized);
  return latest ? summarizeCompletionReport(latest.body, latest.createdAt) : null;
}
