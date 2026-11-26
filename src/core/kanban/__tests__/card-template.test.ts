import { describe, expect, it } from "vitest";
import {
  CARD_TEMPLATE_MARKDOWN,
  CARD_TEMPLATE_SECTIONS,
  CARD_VERIFICATION_TABLE_COLUMNS,
  auditCardObjective,
  renderCardTemplate,
} from "../card-template";

const COMPLETE_CARD = `# 菜单·隐藏插件项：右键不再出现三行

## 摘要
现状：菜单里多出三行插件项。
本卡做：隐藏它们。
边界：只改 local-tools；DSH 源码由另一张卡负责。

## 执行计划
1. 动手前读 AGENTS.md
2. 改 src/client.js
3. 跑 node --test

## 关键文件
- \`src/client.js:1012\` · menu.item 注册

## 风险提示
- **不重装不生效**：桌面版加载的是副本。

## 验收契约（出题人）
标准来源：generic → local-tools；经验包：dsh-config

## 必做
| 编号 | 情况 | 预期结果 | 判法 | 档位 | 档位理由 | 预计耗时 |
|---|---|---|---|---|---|---|
| C1 | 菜单渲染 | 三行消失 | L1：node --test | 必做 | 主路径 | 5 |

## 反向测试
- F1 撤掉改动再跑，断言应变红。
`;

const ENGLISH_CARD = `## Summary
Body.

## Execution Plan
1. step

## Key Files & Entry Points
- a.ts:1

## Risk Notes
- risk

## 验收契约
generic

## 必做
| a |

## F1–F4
- F1 ...
`;

describe("auditCardObjective", () => {
  it("accepts a complete Chinese card", () => {
    expect(auditCardObjective(COMPLETE_CARD).missing).toEqual([]);
  });

  it("accepts the older English section names as aliases", () => {
    const audit = auditCardObjective(ENGLISH_CARD);
    expect(audit.missing).not.toContain("summary");
    expect(audit.missing).not.toContain("plan");
    expect(audit.missing).not.toContain("files");
    expect(audit.missing).not.toContain("risks");
    expect(audit.missing).not.toContain("reverse-test");
  });

  it("lists the required sections a thin card is missing", () => {
    const audit = auditCardObjective("## 摘要\n只有背景。");
    expect(audit.missing).toEqual(
      expect.arrayContaining(["plan", "files", "risks", "acceptance", "verification-table", "reverse-test"]),
    );
    expect(audit.warnings[0]).toContain("卡正文缺少");
  });

  it("treats an empty body as missing every required section", () => {
    const audit = auditCardObjective("");
    expect(audit.missing).toEqual(
      CARD_TEMPLATE_SECTIONS.filter((s) => s.required).map((s) => s.id),
    );
  });

  it("does not count optional sections as missing", () => {
    const audit = auditCardObjective(COMPLETE_CARD);
    expect(audit.missing).not.toContain("stop");
    expect(audit.missing).not.toContain("build-notes");
  });
});

describe("renderCardTemplate", () => {
  it("carries the nine sections, the fixed table header and the global clauses", () => {
    const text = renderCardTemplate();
    for (const section of CARD_TEMPLATE_SECTIONS) {
      expect(CARD_TEMPLATE_MARKDOWN).toContain(`## ${section.heading}`);
    }
    expect(text).toContain(CARD_VERIFICATION_TABLE_COLUMNS.join(" | "));
    expect(CARD_TEMPLATE_MARKDOWN).toContain("防护（每张卡都适用");
  });
});
