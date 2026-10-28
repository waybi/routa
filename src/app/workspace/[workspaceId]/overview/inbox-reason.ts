/**
 * Reason text of a Blocked card, parsed from the newest comment (card 7fbfba57).
 * Order: two-line summary ("阻塞原因：X" + "不用你管：/要你定：Y"), the older one-line
 * form ("阻塞原因：X｜需要你定：Y") → Findings section → first paragraph.
 * Every displayed string has its markdown marks removed; `full` is the original.
 * This is the only place that knows the older shapes; callers read headline/action.
 */

export interface InboxReasonText {
  /** Same as `headline` (kept for older callers). */
  text: string;
  /** Why the card is blocked, plain text, without the "阻塞原因：" prefix. */
  headline: string;
  /** Second line verbatim (with its "不用你管：/要你定：" prefix), plain text; null when absent. */
  action: string | null;
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

const SUMMARY_LEGACY = /^(?:阻塞原因|Blocked because)\s*[:：]\s*(.*?)\s*[|｜]\s*(需要你定|Needs your decision)\s*[:：]\s*(.*)$/iu;
const SUMMARY_HEAD = /^(?:阻塞原因|Blocked because)\s*[:：]\s*(.+)$/iu;
const ACTION_LINE = /^(?:不用你管|要你定|No action needed|You decide)\s*[:：]\s*\S/iu;
const FINDINGS_HEADING = /^(?:发现的问题|问题|Findings|Issues(?: found)?)(?:\s*[:：]\s*(.*))?$/iu;
const EMPTY_FINDING = /^(?:none|n\/a|无|没有)[.。]?$/iu;

function parseSummary(body: string): { headline: string; action: string | null } | null {
  const lines = body.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = stripReasonMarkdown(lines[index]);
    const legacy = SUMMARY_LEGACY.exec(line);
    if (legacy && legacy[1]) {
      const zh = legacy[2] === "需要你定";
      return { headline: legacy[1], action: `${legacy[2]}${zh ? "：" : ": "}${legacy[3]}` };
    }
    const head = SUMMARY_HEAD.exec(line);
    if (!head) continue;
    const next = lines.slice(index + 1).map(stripReasonMarkdown).find(Boolean) ?? "";
    return { headline: head[1], action: ACTION_LINE.test(next) ? next : null };
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
  const summary = parseSummary(body);
  if (summary) return { text: summary.headline, headline: summary.headline, action: summary.action, full: body };
  const finding = findingsReason(body);
  const headline = finding ?? stripReasonMarkdown(body.split(/\n\s*\n/u, 1)[0].trim());
  return { text: headline, headline, action: null, full: body };
}
