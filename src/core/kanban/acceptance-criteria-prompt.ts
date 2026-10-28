import { parseCanonicalStory } from "./canonical-story";

export const STRUCTURED_AC_HEADING = "## Acceptance Criteria（结构化字段，评审以此为准）";

const AC_ID_PATTERN = /^\s*(AC\d+)\s*[:：]/i;

/**
 * Prompt section that lists the structured `task.acceptanceCriteria` field and flags
 * AC ids that exist in the field but not in the canonical story YAML (retro L256).
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

  const lines = [STRUCTURED_AC_HEADING, "", ...items.map((item) => `- ${item}`), ""];

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
