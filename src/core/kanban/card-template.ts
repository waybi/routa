/**
 * Canonical card-body template.
 *
 * Derived from the 492 cards in the historical board (2026-09 → 2026-11): the
 * sections below are the ones that recur in cards that reached review without
 * extra rounds. Kept in one constant so the create-task / create-card tools,
 * the `get_card_template` tool and the UI all point at the same text.
 */

import { STRUCTURED_AC_HEADING } from "./acceptance-criteria-prompt";

export interface CardTemplateSection {
  /** Stable id used by audit results. */
  id: string;
  /** Heading written into the card body. */
  heading: string;
  /** Headings accepted by the audit — English drafts used a different set. */
  aliases: string[];
  required: boolean;
  hint: string;
  /** Typical length measured on the historical corpus. */
  size: string;
}

export const CARD_TEMPLATE_SECTIONS: readonly CardTemplateSection[] = [
  {
    id: "summary",
    heading: "摘要",
    aliases: ["摘要", "目标", "Summary", "Overview"],
    required: true,
    hint: "现状一句、本卡做一句、边界一句（另一半由哪张卡负责）",
    size: "300–450 字",
  },
  {
    id: "plan",
    heading: "执行计划",
    aliases: ["执行计划", "Execution Plan"],
    required: true,
    hint: "编号步骤；第一步固定是「动手前读什么」",
    size: "600–3200 字",
  },
  {
    id: "files",
    heading: "关键文件",
    aliases: ["关键文件", "Key Files & Entry Points", "Key Files"],
    required: true,
    hint: "一行一条：路径:行号 · 作用",
    size: "300–950 字",
  },
  {
    id: "stop",
    heading: "不做 / 停下回报的条件",
    aliases: ["不做", "停下回报的条件", "Not in Scope"],
    required: false,
    hint: "只列 2–4 条真正该停的情形，末尾写「其余正常交卡」",
    size: "100–200 字",
  },
  {
    id: "risks",
    heading: "风险提示",
    aliases: ["风险提示", "Risk Notes", "硬性约束"],
    required: true,
    hint: "最容易误判的点，每条带「为什么」；优先写「看起来做了但没生效」",
    size: "800–1600 字",
  },
  {
    id: "acceptance",
    heading: "验收契约（出题人）",
    aliases: ["验收契约", "Acceptance Contract"],
    required: true,
    hint: "一行索引：标准来源 + 经验包名",
    size: "一行",
  },
  {
    id: "verification-table",
    heading: "必做",
    aliases: ["必做", "Mandatory Checks"],
    required: true,
    hint: "三张表（必做/抽查/不适用），固定 7 列；每卡中位 14 条",
    size: "8–12 条必做",
  },
  {
    id: "reverse-test",
    heading: "反向测试",
    aliases: ["反向测试", "F1–F4", "F1–F5", "F1"],
    required: true,
    hint: "至少 1 条：撤掉改动应该变红，证明测试真的在测",
    size: "3–5 条",
  },
  {
    id: "build-notes",
    heading: "施工注意",
    aliases: ["施工注意", "Build Notes"],
    required: false,
    hint: "部署方式、要不要重启、机器负载上限",
    size: "300–3000 字",
  },
] as const;

/** Fixed column set of the three verification tables (1,149 historical uses). */
export const CARD_VERIFICATION_TABLE_COLUMNS = [
  "编号",
  "情况",
  "预期结果",
  "判法",
  "档位",
  "档位理由",
  "预计耗时",
] as const;

/** Global clauses that are copied verbatim into every card. */
export const CARD_GLOBAL_CLAUSES = `## 防护（每张卡都适用，违反任何一条都算不通过）
- 只在 Routa 分给本卡的工作副本里改和提交，不 cd 到其他检出。
- 只准提交「关键文件」里列的文件。
- 不读写真实配置、线上数据、真实账号目录。
- push 和合并由 Done 列负责，本卡不推。

## 推送时 README 冲突怎么处理（给 Done 列推送员）
<按仓库约定填写>

## 机器负载
<并发上限、不许卡死电脑、跑完释放>`;

export const CARD_TEMPLATE_MARKDOWN = `# <模块>·<动作>：<可见结果>

## 摘要
现状：<一句话>。
本卡做：<一句话>。
边界：只改 <X>；<Y> 由 <哪张卡> 负责。

## 执行计划
1. 动手前读：<AGENTS.md / 项目页 / 经验包>
2. <步骤>
3. <步骤>
4. 跑验证命令，留证据到 <路径>

## 关键文件
- \`<路径>:<行号>\` · <作用>
- \`<路径>:<行号>\` · <作用>

## 不做 / 停下回报的条件
- <情形 1>：<怎么办>，正常交卡。
- <情形 2>：停下回报，写清缺什么、证据在哪。
- 其余情况正常交卡，不中途提问。

## 风险提示
- **<最容易误判的点>**：<为什么>。

## 验收契约（出题人）
标准来源：<包>；经验包：<名字>

## 必做
| 编号 | 情况 | 预期结果 | 判法 | 档位 | 档位理由 | 预计耗时 |
|---|---|---|---|---|---|---|
| C1 | <正常路径> | <可观测结果> | L1：<怎么跑> | 必做 | <理由> | <分钟> |

## 抽查
| 编号 | 情况 | 预期结果 | 判法 | 档位 | 档位理由 | 预计耗时 |
|---|---|---|---|---|---|---|
| C9 | <跨环境/跨入口> | <可观测结果> | L2：<怎么跑> | 抽查 | <理由> | <分钟> |

## 不适用
| 编号 | 情况 | 预期结果 | 判法 | 档位 | 档位理由 | 预计耗时 |
|---|---|---|---|---|---|---|
| C20 | <本卡没有的入口> | 不适用 | — | 不适用 | <为什么没有> | — |

## 反向测试
- F1 撤掉改动再跑：<哪条断言应该变红>；恢复后全绿。

## 施工注意
<部署/重启/机器负载>

${CARD_GLOBAL_CLAUSES}`;

export interface CardObjectiveAudit {
  /** Section ids that are required but absent from the body. */
  missing: string[];
  /** Ready-to-append warnings; empty when the body is complete. */
  warnings: string[];
}

const HEADING_PATTERN = /^\s{0,3}#{1,4}\s*(.+?)\s*$/gm;

function normalizeHeading(value: string): string {
  return value
    .replace(/^\d+[.、]\s*/, "")
    .replace(/[：:]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function headingsOf(objective: string): Set<string> {
  const set = new Set<string>();
  for (const match of objective.matchAll(HEADING_PATTERN)) {
    const heading = match[1] ?? "";
    // Table cells and code fences can start with '#'; keep only heading-like lines.
    if (!heading || heading.startsWith("|")) continue;
    set.add(normalizeHeading(heading));
  }
  return set;
}

/** Match an alias against a heading, allowing suffixed qualifiers such as 「必做（L2 第 1 条）」. */
function hasHeading(headings: Set<string>, alias: string): boolean {
  const target = normalizeHeading(alias);
  if (headings.has(target)) return true;
  for (const heading of headings) {
    if (heading.startsWith(target) || target.startsWith(heading)) return true;
  }
  return false;
}

/**
 * Report the required sections missing from a card body. Advisory only: the
 * caller keeps the card, the warning tells the dispatcher which part to fill.
 */
export function auditCardObjective(objective: string | undefined): CardObjectiveAudit {
  const body = objective ?? "";
  if (!body.trim()) {
    return {
      missing: CARD_TEMPLATE_SECTIONS.filter((s) => s.required).map((s) => s.id),
      warnings: ["卡正文为空：先取 get_card_template，按九节填写后再派。"],
    };
  }

  const headings = headingsOf(body);
  // The structured AC section is rendered by the card detail view, not written
  // by the dispatcher; accept it as the acceptance contract when present.
  const hasStructuredAc = body.includes(STRUCTURED_AC_HEADING);

  const missing: string[] = [];
  for (const section of CARD_TEMPLATE_SECTIONS) {
    if (!section.required) continue;
    if (section.id === "acceptance" && hasStructuredAc) continue;
    const hit = section.aliases.some((alias) => hasHeading(headings, alias));
    if (!hit) missing.push(section.id);
  }

  if (missing.length === 0) return { missing, warnings: [] };

  const labels = CARD_TEMPLATE_SECTIONS
    .filter((s) => missing.includes(s.id))
    .map((s) => s.heading);
  return {
    missing,
    warnings: [
      `卡正文缺少 ${missing.length} 节：${labels.join("、")}。补法见 get_card_template（九节骨架与字数区间）。`,
    ],
  };
}

/** Full template with the section index, for the `get_card_template` tool. */
export function renderCardTemplate(): string {
  const index = CARD_TEMPLATE_SECTIONS
    .map((s, i) => `${i + 1}. ${s.heading}（${s.required ? "必填" : "按需"}，${s.size}）— ${s.hint}`)
    .join("\n");
  return [
    "# 派卡固定格式 v1",
    "",
    "## 九节（按顺序）",
    index,
    "",
    "## 三张验收表固定 7 列",
    CARD_VERIFICATION_TABLE_COLUMNS.join(" | "),
    "",
    CARD_TEMPLATE_MARKDOWN,
  ].join("\n");
}
