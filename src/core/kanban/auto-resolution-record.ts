/**
 * The Blocked resolver's "## 自动处理记录" comment (card 64f2e31c).
 *
 * Every resolver run ends with one comment whose first line is
 * `## 自动处理记录` (English prompt: `## Auto Resolution Record`) and which
 * carries five fixed sections. The 卡在哪 section quotes the routing reason
 * (`attention:<kind>`) so rounds can be counted per reason: the same reason
 * handled twice turns into "needs the owner" on the third round.
 */

export const AUTO_RESOLUTION_RECORD_HEADINGS = ["## 自动处理记录", "## Auto Resolution Record"] as const;

export type AutoResolutionSectionKey = "stuck" | "judgement" | "actions" | "check" | "notDone";

/** Section titles per key: Chinese first, then the English prompt's titles. */
export const AUTO_RESOLUTION_SECTIONS: Record<AutoResolutionSectionKey, readonly string[]> = {
  stuck: ["卡在哪", "Where it is stuck"],
  judgement: ["判断", "Judgement"],
  actions: ["做了什么", "What was done"],
  check: ["结果核对", "Result check"],
  notDone: ["没做什么、为什么", "What was not done and why"],
};

const SECTION_ORDER: readonly AutoResolutionSectionKey[] = ["stuck", "judgement", "actions", "check", "notDone"];

/** At most this many rounds per card per reason; the next one goes to the owner. */
export const MAX_AUTO_RESOLUTION_ROUNDS = 2;

export interface AutoResolutionRecord {
  valid: boolean;
  sections: Partial<Record<AutoResolutionSectionKey, string>>;
  /** Section keys missing or empty; empty when valid. */
  missing: AutoResolutionSectionKey[];
  /** `attention:<kind>` reasons quoted in the 卡在哪 section. */
  reasons: string[];
}

function normalizeTitle(value: string): string {
  return value.replace(/[\s:：]+$/u, "").trim().toLowerCase();
}

function sectionKeyOf(title: string): AutoResolutionSectionKey | undefined {
  const normalized = normalizeTitle(title);
  return SECTION_ORDER.find((key) => AUTO_RESOLUTION_SECTIONS[key].some((name) => name.toLowerCase() === normalized));
}

export function isAutoResolutionRecord(body: string | undefined | null): boolean {
  const firstLine = (body ?? "").trimStart().split("\n", 1)[0]?.trim() ?? "";
  return AUTO_RESOLUTION_RECORD_HEADINGS.some((heading) => firstLine === heading);
}

/** Parses one comment; null when its first line is not a record heading. */
export function parseAutoResolutionRecord(body: string | undefined | null): AutoResolutionRecord | null {
  if (!isAutoResolutionRecord(body)) return null;
  const lines = (body ?? "").trimStart().split("\n").slice(1);
  const sections: Partial<Record<AutoResolutionSectionKey, string>> = {};
  let current: AutoResolutionSectionKey | undefined;
  let buffer: string[] = [];
  const flush = () => {
    if (current) sections[current] = buffer.join("\n").trim();
    buffer = [];
  };
  for (const line of lines) {
    const heading = /^###\s+(.+)$/u.exec(line.trim());
    if (heading) {
      flush();
      current = sectionKeyOf(heading[1]);
      continue;
    }
    if (current) buffer.push(line);
  }
  flush();
  const missing = SECTION_ORDER.filter((key) => !sections[key]);
  const reasons = Array.from(new Set((sections.stuck ?? "").match(/attention:[A-Za-z]+/gu) ?? []));
  return { valid: missing.length === 0, sections, missing, reasons };
}

/** Valid records among a card's comments (oldest first). */
export function listAutoResolutionRecords(comments: ReadonlyArray<{ body: string }> | undefined): AutoResolutionRecord[] {
  return (comments ?? [])
    .map((comment) => parseAutoResolutionRecord(comment.body))
    .filter((record): record is AutoResolutionRecord => record !== null && record.valid);
}

/** Rounds already spent on `reason` (e.g. `attention:doneFailed`); other reasons do not count. */
export function countResolutionRounds(comments: ReadonlyArray<{ body: string }> | undefined, reason: string): number {
  return listAutoResolutionRecords(comments).filter((record) => record.reasons.includes(reason)).length;
}

/** True when the next round for `reason` must go to the owner instead. */
export function shouldEscalateToOwner(comments: ReadonlyArray<{ body: string }> | undefined, reason: string): boolean {
  return countResolutionRounds(comments, reason) >= MAX_AUTO_RESOLUTION_ROUNDS;
}

/** Raw text of the newest record comment (valid or not), for the inbox. */
export function latestAutoResolutionRecordText(comments: ReadonlyArray<{ body: string }> | undefined): string | null {
  const list = comments ?? [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (isAutoResolutionRecord(list[index]?.body)) return list[index].body.trim();
  }
  return null;
}
