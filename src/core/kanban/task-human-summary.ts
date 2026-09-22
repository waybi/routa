import { parseCanonicalStory, type CanonicalStoryAcceptanceCriterion } from "./canonical-story";

/**
 * Human-readable card summary ("人话版").
 *
 * Pure, browser-safe helpers shared by the API route, the generator and the UI:
 * - deterministic fact extraction from the canonical YAML + known sections
 * - summarizer prompt (carries every writing-style rule in one place)
 * - banned-phrase lint applied to the generated summary
 *
 * Hashing lives in task-human-summary-store.ts (needs node:crypto).
 * Nothing here writes to the task description or touches gates.
 *
 * Rust twin: crates/routa-server/src/api/tasks/human_summary.rs. The prompt text, banned-pattern
 * list, hash normalization and cache file naming must stay byte-for-byte aligned; change both in
 * the same commit (both backends read/write the same ~/.routa/task-summaries cache).
 */

export type TaskHumanSummaryLanguage = "en" | "zh-CN";

export interface TaskHumanSummaryEvidence {
  /** Short label a reader can search for in the description / evidence tab. */
  label: string;
  /** Where to look: a quoted fragment, section heading, artifact type or AC id. */
  where: string;
}

export interface TaskHumanSummaryContent {
  /** One sentence: what this card is for. */
  what: string;
  /** Where the work currently stands (latest state only). */
  where: string;
  /** What is blocking it / who does what next. */
  blockedNext: string;
  /** Evidence pointers ordered by verifiability, not by time. */
  evidence: TaskHumanSummaryEvidence[];
}

export interface TaskHumanSummaryRecord {
  taskId: string;
  /** sha256 of the normalized description at generation time. */
  descriptionHash: string;
  language: TaskHumanSummaryLanguage;
  model: string;
  generatedAt: string;
  summary: TaskHumanSummaryContent;
  /** Banned phrases still present after the retry, if any (kept for transparency). */
  lintHits: string[];
}

export interface TaskHumanSummaryFacts {
  title: string;
  problemStatement: string | null;
  userValue: string | null;
  acceptanceCriteria: CanonicalStoryAcceptanceCriterion[];
  laneId: string;
  isBlockedLane: boolean;
  /** Present when the description marks itself as blocked or the YAML says independent_story_check: fail. */
  blockReason: string | null;
  dependsOn: string[];
  unblockCondition: string | null;
  hasCanonicalYaml: boolean;
  /** Headings found outside the YAML block, in document order. */
  sectionHeadings: string[];
}

const BLOCKED_LANE_IDS = new Set(["blocked"]);
const BLOCKED_HEADING_HINTS = [/阻塞/, /blocked/i];
const HEADING_REGEX = /^#{1,6}\s+(.+?)\s*$/gm;
const FENCE_REGEX = /```[\s\S]*?```/g;

/**
 * Chinese and English phrases the summarizer must not emit. Order matters only for reporting.
 * Each entry is a RegExp so "第 N 轮" style patterns can be matched too.
 */
export const TASK_HUMAN_SUMMARY_BANNED_PATTERNS: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  { id: "值得注意的是", pattern: /值得注意的是/ },
  { id: "综上所述", pattern: /综上所述/ },
  { id: "总的来说", pattern: /总的来说/ },
  { id: "简单来说", pattern: /简单来说/ },
  { id: "不是分歧", pattern: /不是分歧/ },
  { id: "第N轮", pattern: /第\s*[一二三四五六七八九十\d]+\s*轮/ },
  { id: "it's worth noting", pattern: /it'?s worth noting/i },
  { id: "importantly", pattern: /\bimportantly\b/i },
  { id: "delve", pattern: /\bdelv(e|es|ing)\b/i },
  { id: "leverage", pattern: /\bleverag(e|es|ing)\b/i },
  { id: "in summary", pattern: /\bin summary\b/i },
  { id: "round N", pattern: /\bround\s+\d+\b/i },
];

export function normalizeTaskDescription(description: string | null | undefined): string {
  return (description ?? "").replace(/\r\n/g, "\n").trim();
}

function stripFences(content: string): string {
  return content.replace(FENCE_REGEX, "");
}

function collectHeadings(content: string): string[] {
  const headings: string[] = [];
  const withoutFences = stripFences(content);
  for (const match of withoutFences.matchAll(HEADING_REGEX)) {
    const text = match[1]?.trim();
    if (text) headings.push(text);
  }
  return headings;
}

function findBlockedHeading(headings: string[]): string | null {
  return headings.find((heading) => BLOCKED_HEADING_HINTS.some((hint) => hint.test(heading))) ?? null;
}

/**
 * Deterministic facts, rendered instantly without any LLM call.
 * Works for legacy cards with a plain-text description (everything degrades to null / []).
 */
export function extractTaskHumanSummaryFacts(task: {
  title: string;
  objective?: string | null;
  columnId?: string | null;
}): TaskHumanSummaryFacts {
  const description = normalizeTaskDescription(task.objective);
  const parsed = parseCanonicalStory(description);
  const story = parsed.story?.story ?? null;
  const headings = collectHeadings(description);
  const laneId = task.columnId ?? "backlog";
  const isBlockedLane = BLOCKED_LANE_IDS.has(laneId);
  const blockedHeading = findBlockedHeading(headings);
  const independentFail = story?.dependencies_and_sequencing.independent_story_check === "fail";

  let blockReason: string | null = null;
  if (independentFail && story) {
    blockReason = story.invest.independent.reason || story.dependencies_and_sequencing.unblock_condition || null;
  } else if (blockedHeading) {
    blockReason = blockedHeading;
  } else if (isBlockedLane) {
    blockReason = laneId;
  }

  return {
    title: story?.title || task.title,
    problemStatement: story?.problem_statement ?? null,
    userValue: story?.user_value ?? null,
    acceptanceCriteria: story?.acceptance_criteria ?? [],
    laneId,
    isBlockedLane,
    blockReason,
    dependsOn: story?.dependencies_and_sequencing.depends_on ?? [],
    unblockCondition: story?.dependencies_and_sequencing.unblock_condition ?? null,
    hasCanonicalYaml: parsed.hasYamlBlock,
    sectionHeadings: headings,
  };
}

/**
 * Returns the ids of banned patterns present in the prose fields and evidence labels.
 * `evidence[].where` is exempt on purpose: it is a verbatim locator, and quoting a section
 * heading such as "第二轮 Backlog 梳理" there is how the reader finds the passage.
 */
export function lintTaskHumanSummary(summary: TaskHumanSummaryContent): string[] {
  const corpus = [
    summary.what,
    summary.where,
    summary.blockedNext,
    ...summary.evidence.map((item) => item.label),
  ].join("\n");
  return TASK_HUMAN_SUMMARY_BANNED_PATTERNS
    .filter(({ pattern }) => pattern.test(corpus))
    .map(({ id }) => id);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Accepts the loosely-shaped JSON the model returns and coerces it into the fixed four-part layout.
 * Returns null when the required prose fields are missing.
 */
export function coerceTaskHumanSummary(value: unknown): TaskHumanSummaryContent | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const what = asString(record.what);
  const where = asString(record.where);
  const blockedNext = asString(record.blockedNext ?? record.blocked_next);
  if (!what || !where || !blockedNext) return null;

  const evidenceRaw = Array.isArray(record.evidence) ? record.evidence : [];
  const evidence = evidenceRaw.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const entry = item as Record<string, unknown>;
    const label = asString(entry.label);
    const location = asString(entry.where);
    if (!label) return [];
    return [{ label, where: location }];
  });

  return { what, where, blockedNext, evidence };
}

export function parseTaskHumanSummaryResponse(text: string): TaskHumanSummaryContent | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const candidates = [
    trimmed,
    trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""),
  ];
  const braceStart = trimmed.indexOf("{");
  const braceEnd = trimmed.lastIndexOf("}");
  if (braceStart >= 0 && braceEnd > braceStart) {
    candidates.push(trimmed.slice(braceStart, braceEnd + 1));
  }
  for (const candidate of candidates) {
    try {
      const parsed = coerceTaskHumanSummary(JSON.parse(candidate));
      if (parsed) return parsed;
    } catch {
      // try next candidate
    }
  }
  return null;
}

const STYLE_RULES_ZH = `写作规则（全部必须遵守）：
1. 结论先行。每一段先给结论，再给依据。
2. 说人话：用常见词和精确动词，主动语态。术语、缩写、UUID 第一次出现时紧跟一句大白话解释（例如「5cea679a（请求转发层那张卡）」）。
3. 只写最新状态，禁止按轮次记流水账。what / where / blockedNext 三段和证据名称里禁止出现「第 N 轮」「第一轮」「上一轮」等字样；描述里带轮次的章节标题只允许原样写进证据的 where 定位字段。
4. 黑名单，一个都不能出现：值得注意的是、综上所述、总的来说、简单来说、不是分歧、以及任何「不是 X 而是 Y」式的对比句。
5. 不夸自己，不评价流程；描述里的情绪词、加粗强调一律去掉。
6. 证据按「读者最容易自行核对」排序，不按时间排序。每条证据给一个可搜索的定位（章节标题、AC 编号、文件:行号、artifact 类型）。
7. 每段不超过 3 句；四段合计不超过 300 字（证据列表不计）。`;

const STYLE_RULES_EN = `Writing rules (all mandatory):
1. Lead with the conclusion in every field, then the reasoning.
2. Plain language: familiar words, precise verbs, active voice. The first time a term, acronym or UUID appears, follow it with a one-clause plain explanation, e.g. "5cea679a (the request-forwarding card)".
3. Describe the latest state only. Never narrate by rounds in what / where / blockedNext or evidence labels: no "round 1", "second pass", "previous iteration". A section heading that contains a round number may only be quoted verbatim inside an evidence "where" locator.
4. Banned, never emit: "it's worth noting", "importantly", "in summary", "delve", "leverage", and any "not X but Y" contrast framing.
5. No self-praise, no process commentary; drop emphasis and emotional wording from the source.
6. Order evidence by how easily a reader can verify it, not by time. Each item names a searchable location (section heading, AC id, file:line, artifact type).
7. At most 3 sentences per field; the four prose fields together stay under 180 words (evidence list excluded).`;

function formatFactsForPrompt(facts: TaskHumanSummaryFacts, language: TaskHumanSummaryLanguage): string {
  const lines: string[] = [];
  const label = language === "zh-CN"
    ? { title: "标题", lane: "当前泳道", ac: "验收标准", blocked: "阻塞原因", deps: "依赖卡", unblock: "解锁条件", headings: "描述章节" }
    : { title: "Title", lane: "Current lane", ac: "Acceptance criteria", blocked: "Block reason", deps: "Depends on", unblock: "Unblock condition", headings: "Description sections" };
  lines.push(`${label.title}: ${facts.title}`);
  lines.push(`${label.lane}: ${facts.laneId}`);
  if (facts.acceptanceCriteria.length > 0) {
    lines.push(`${label.ac}:`);
    for (const criterion of facts.acceptanceCriteria) {
      lines.push(`- ${criterion.id}: ${criterion.text}`);
    }
  }
  if (facts.blockReason) lines.push(`${label.blocked}: ${facts.blockReason}`);
  if (facts.dependsOn.length > 0) lines.push(`${label.deps}: ${facts.dependsOn.join(", ")}`);
  if (facts.unblockCondition) lines.push(`${label.unblock}: ${facts.unblockCondition}`);
  if (facts.sectionHeadings.length > 0) lines.push(`${label.headings}: ${facts.sectionHeadings.join(" | ")}`);
  return lines.join("\n");
}

export interface BuildTaskHumanSummaryPromptOptions {
  language: TaskHumanSummaryLanguage;
  facts: TaskHumanSummaryFacts;
  description: string;
  /** Banned phrases hit by the previous attempt; when present the prompt asks for a rewrite. */
  previousLintHits?: string[];
  maxDescriptionChars?: number;
}

export function buildTaskHumanSummaryPrompt(options: BuildTaskHumanSummaryPromptOptions): string {
  const maxChars = options.maxDescriptionChars ?? 24_000;
  const description = options.description.length > maxChars
    ? `${options.description.slice(0, maxChars)}\n\n[truncated]`
    : options.description;
  const zh = options.language === "zh-CN";
  const retryNote = options.previousLintHits && options.previousLintHits.length > 0
    ? (zh
      ? `\n上一版命中了黑名单：${options.previousLintHits.join("、")}。请重写并彻底避开这些词和句式。\n`
      : `\nThe previous draft contained banned phrases: ${options.previousLintHits.join(", ")}. Rewrite and avoid them entirely.\n`)
    : "";

  const intro = zh
    ? `你是看板卡片的总结器。下面这张卡片的描述是写给 agent 看的（机器契约 YAML + 过程日志），请把它改写成给人看的四段摘要。只能使用描述里出现的事实，不得补充或推测。`
    : `You summarize kanban cards. The description below was written for agents (machine YAML contract + process log). Rewrite it as a four-part summary for a human reader. Use only facts present in the description; do not add or infer.`;

  const layout = zh
    ? `输出格式：只输出一个 JSON 对象，不加任何解释或代码围栏：
{
  "what": "这张卡要做什么（一句话）",
  "where": "现在到哪一步（最新状态）",
  "blockedNext": "卡在哪 / 下一步谁做什么",
  "evidence": [ { "label": "证据名称", "where": "在描述里怎么找到（章节标题 / AC 编号 / 文件:行号 / artifact 类型）" } ]
}
evidence 给 2 到 6 条。全部内容使用简体中文。`
    : `Output format: exactly one JSON object, no explanation, no code fence:
{
  "what": "what this card is for (one sentence)",
  "where": "where the work stands now (latest state)",
  "blockedNext": "what blocks it / who does what next",
  "evidence": [ { "label": "evidence name", "where": "how to find it in the description (section heading / AC id / file:line / artifact type)" } ]
}
Give 2 to 6 evidence items. Write everything in English.`;

  return [
    intro,
    "",
    zh ? STYLE_RULES_ZH : STYLE_RULES_EN,
    retryNote,
    zh ? "已确定的事实（由程序解析，可直接引用）：" : "Facts already extracted by the program (safe to reference):",
    formatFactsForPrompt(options.facts, options.language),
    "",
    zh ? "卡片描述原文：" : "Card description:",
    "<<<DESCRIPTION",
    description,
    "DESCRIPTION>>>",
    "",
    layout,
  ].join("\n");
}
