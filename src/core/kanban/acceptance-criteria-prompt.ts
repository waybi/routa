import { parseCanonicalStory } from "./canonical-story";

export const STRUCTURED_AC_HEADING = "## Acceptance Criteria（结构化字段，评审以此为准）";

const AC_ID_PATTERN = /^\s*(AC\d+)\s*[:：]/i;
// Already-numbered entry: AC3 / AC-3 (digits, "-" optional) or AC-a (letters need "-"),
// followed by : ： whitespace . 、 or end. Avoids treating "Accept…" / "ACME…" as numbered.
const EXISTING_AC_ID = /^\s*AC(?:-?(\d+)|-[A-Za-z0-9]+)(?=[:：\s.、]|$)/i;

/** Prefix unnumbered items with AC-n (smallest unused n, in order); numbered items kept verbatim. Pure. */
function numberItems(items: string[]): string[] {
  const used = new Set<number>();
  for (const item of items) {
    const m = EXISTING_AC_ID.exec(item);
    if (m?.[1]) used.add(Number(m[1]));
  }
  let n = 1;
  return items.map((item) => {
    if (EXISTING_AC_ID.test(item)) return item;
    while (used.has(n)) n++;
    return `AC-${n++}: ${item.trim()}`;
  });
}

/**
 * Prompt section that lists the structured `task.acceptanceCriteria` field and flags
 * AC ids that exist in the field but not in the canonical story YAML (retro L256).
 * Unnumbered items get an AC-n prefix for display only (input is never mutated).
 * Returns [] when the field has no non-empty entries.
 */
export function buildStructuredAcceptanceCriteriaLines(
  acceptanceCriteria: string[] | undefined,
  objective: string | undefined,
): string[] {
  const items = (acceptanceCriteria ?? []).filter(
    (item) => typeof item === "string" && item.trim().length > 0,
  );
  if (items.length === 0) return [];

  const lines = [STRUCTURED_AC_HEADING, "", ...numberItems(items).map((item) => `- ${item}`), ""];

  const parsed = parseCanonicalStory(objective);
  if (!parsed.story) return lines;

  const yamlIds = new Set(parsed.story.story.acceptance_criteria.map((ac) => ac.id.trim().toUpperCase()));
  const missing: string[] = [];
  for (const item of items) {
    const id = AC_ID_PATTERN.exec(item)?.[1]?.toUpperCase();
    if (id && !yamlIds.has(id) && !missing.includes(id)) missing.push(id);
  }
  if (missing.length > 0) {
    lines.push(
      `⚠️ canonical YAML 缺少 ${missing.join("、")}；以本节结构化字段为准，逐条给结论。`,
      "",
    );
  }
  return lines;
}
