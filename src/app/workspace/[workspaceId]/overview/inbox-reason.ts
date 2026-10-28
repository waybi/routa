/**
 * Reason text of a Blocked card, parsed from the newest comment (card 7fbfba57).
 * Order: summary line ("阻塞原因：X｜需要你定：Y") → Findings section → first paragraph.
 * Every displayed string has its markdown marks removed; `full` is the original.
 */

export interface InboxReasonText {
  /** Same as `why` (kept for older callers). */
  text: string;
  /** Why the card is blocked, plain text. */
  why: string;
  /** What the owner has to decide, plain text; null when the comment has none. */
  decision: string | null;
  /** Whole comment, verbatim, for the title attribute and the expanded view. */
  full: string;
}

/** Removes list/quote/heading prefixes, bold marks and backticks; merges lines with single spaces. */
export function stripReasonMarkdown(text: string): string {
  return text
    .split(/\r?\n/u)
    .map((line) => line
      .replace(/^[\s>]*(?:#{1,6}\s+|[-*+]\s+)?/u, "")
      .replace(/\*\*|__|`/gu, "")
      .trim())
    .filter(Boolean)
    .join(" ");
}

const SUMMARY_LINE = /^(?:阻塞原因|Blocked because)\s*[:：]\s*(.*?)\s*[|｜]\s*(?:需要你定|Needs your decision)\s*[:：]\s*(.*)$/iu;
const SUMMARY_WHY_ONLY = /^(?:阻塞原因|Blocked because)\s*[:：]\s*(.+)$/iu;
const FINDINGS_HEADING = /^(?:发现的问题|问题|Findings|Issues(?: found)?)(?:\s*[:：]\s*(.*))?$/iu;
const EMPTY_FINDING = /^(?:none|n\/a|无|没有)[.。]?$/iu;

function parseSummaryLine(body: string): { why: string; decision: string | null } | null {
  for (const raw of body.split(/\r?\n/u)) {
    const line = stripReasonMarkdown(raw);
    const full = SUMMARY_LINE.exec(line);
    if (full && full[1]) return { why: full[1], decision: full[2] || null };
    const whyOnly = SUMMARY_WHY_ONLY.exec(line);
    if (whyOnly) return { why: whyOnly[1], decision: null };
  }
  return null;
}

function findingsReason(body: string): string | null {
  const lines = body.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const heading = FINDINGS_HEADING.exec(stripReasonMarkdown(lines[index]));
    if (!heading) continue;
    const inline = (heading[1] ?? "").trim();
    if (inline) {
      if (EMPTY_FINDING.test(inline)) continue;
      return inline;
    }
    for (let next = index + 1; next < lines.length; next += 1) {
      const raw = lines[next].trim();
      if (!raw || raw.startsWith("|") || /^[-=_*\s]{3,}$/u.test(raw)) continue;
      if (/^#{1,6}\s/u.test(raw)) break;
      const text = stripReasonMarkdown(raw).replace(/^\d+[.)]\s+/u, "");
      if (text) return text;
    }
  }
  return null;
}

export function parseInboxReason(body: string): InboxReasonText {
  const summary = parseSummaryLine(body);
  if (summary) return { text: summary.why, why: summary.why, decision: summary.decision, full: body };
  const finding = findingsReason(body);
  const why = finding ?? stripReasonMarkdown(body.split(/\n\s*\n/u, 1)[0].trim());
  return { text: why, why, decision: null, full: body };
}
