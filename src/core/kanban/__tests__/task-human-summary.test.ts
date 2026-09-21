import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildTaskHumanSummaryPrompt,
  extractTaskHumanSummaryFacts,
  lintTaskHumanSummary,
  parseTaskHumanSummaryResponse,
  type TaskHumanSummaryContent,
} from "../task-human-summary";
import { FileTaskHumanSummaryStore, hashTaskDescription } from "../task-human-summary-store";
import { generateTaskHumanSummary, TaskHumanSummaryGenerationError } from "../task-human-summary-generator";

const HEAVY_DESCRIPTION = `承接自母卡 \`d5e0a0a2\`。

## 第二轮 Backlog 梳理（吸收 Todo 退回意见）

Todo Entry Gate 第一轮退回。

### 一、AC1 恒判通过风险：已修补

## ⚠️ 本卡为「据实阻塞」卡，不应推进到 Todo

\`\`\`yaml
story:
  version: 1
  language: zh-CN
  title: "错误路径复走查：转发降级与入口按钮落地后补测场景"
  problem_statement: "母卡矩阵中场景 ⑧⑨ 留档的是修复前形态。"
  user_value: "验收人看到的是真实可复现的形态。"
  acceptance_criteria:
    - id: AC1
      text: "场景 ⑧ 复走查，五项断言全部满足。"
      testable: true
    - id: AC2
      text: "场景 ⑨ 复走查，按钮节点数为 0。"
      testable: true
  constraints_and_affected_areas:
    - "只读核对不修改"
  dependencies_and_sequencing:
    independent_story_check: fail
    depends_on:
      - "5cea679a-3642-48dc-8ca1-b92558647c2d"
    unblock_condition: "前置卡进入 done 列。"
  out_of_scope:
    - "不修改产品代码"
  invest:
    independent:
      status: fail
      reason: "强依赖前置卡，其落地前走查形态不存在。"
    negotiable:
      status: pass
      reason: "可协商。"
    valuable:
      status: pass
      reason: "有价值。"
    estimable:
      status: warning
      reason: "取决于前置卡。"
    small:
      status: pass
      reason: "小。"
    testable:
      status: pass
      reason: "可测。"
\`\`\`
`;

const CLEAN_SUMMARY: TaskHumanSummaryContent = {
  what: "复走查两个错误场景并替换母卡证据。",
  where: "卡片在 review 列，等待前置卡落地。",
  blockedNext: "两张前置卡进入 done 后，由 Backlog 阶段回流细化。",
  evidence: [{ label: "AC1 五项断言", where: "acceptance_criteria AC1" }],
};

describe("extractTaskHumanSummaryFacts", () => {
  it("reads title, AC table, dependencies and block reason from canonical YAML", () => {
    const facts = extractTaskHumanSummaryFacts({
      title: "fallback title",
      objective: HEAVY_DESCRIPTION,
      columnId: "review",
    });

    expect(facts.hasCanonicalYaml).toBe(true);
    expect(facts.title).toBe("错误路径复走查：转发降级与入口按钮落地后补测场景");
    expect(facts.problemStatement).toContain("修复前形态");
    expect(facts.acceptanceCriteria.map((item) => item.id)).toEqual(["AC1", "AC2"]);
    expect(facts.laneId).toBe("review");
    expect(facts.isBlockedLane).toBe(false);
    expect(facts.blockReason).toBe("强依赖前置卡，其落地前走查形态不存在。");
    expect(facts.dependsOn).toEqual(["5cea679a-3642-48dc-8ca1-b92558647c2d"]);
    expect(facts.unblockCondition).toBe("前置卡进入 done 列。");
  });

  it("collects headings outside the YAML block in order", () => {
    const facts = extractTaskHumanSummaryFacts({ title: "x", objective: HEAVY_DESCRIPTION });
    expect(facts.sectionHeadings).toEqual([
      "第二轮 Backlog 梳理（吸收 Todo 退回意见）",
      "一、AC1 恒判通过风险：已修补",
      "⚠️ 本卡为「据实阻塞」卡，不应推进到 Todo",
    ]);
  });

  it("degrades gracefully for a legacy plain-text card", () => {
    const facts = extractTaskHumanSummaryFacts({
      title: "Legacy card",
      objective: "Just a sentence with no structure.",
      columnId: undefined,
    });

    expect(facts.hasCanonicalYaml).toBe(false);
    expect(facts.title).toBe("Legacy card");
    expect(facts.problemStatement).toBeNull();
    expect(facts.acceptanceCriteria).toEqual([]);
    expect(facts.laneId).toBe("backlog");
    expect(facts.blockReason).toBeNull();
    expect(facts.sectionHeadings).toEqual([]);
  });

  it("flags the blocked lane even without YAML", () => {
    const facts = extractTaskHumanSummaryFacts({ title: "x", objective: "", columnId: "blocked" });
    expect(facts.isBlockedLane).toBe(true);
    expect(facts.blockReason).toBe("blocked");
  });
});

describe("hashTaskDescription", () => {
  it("is stable across CRLF and surrounding whitespace, and changes with content", () => {
    expect(hashTaskDescription("a\r\nb")).toBe(hashTaskDescription("  a\nb\n"));
    expect(hashTaskDescription("a")).not.toBe(hashTaskDescription("b"));
    expect(hashTaskDescription(undefined)).toBe(hashTaskDescription(""));
  });
});

describe("lintTaskHumanSummary", () => {
  it("returns no hits for a clean summary", () => {
    expect(lintTaskHumanSummary(CLEAN_SUMMARY)).toEqual([]);
  });

  it("catches Chinese AI-speak, round narration and English filler", () => {
    const hits = lintTaskHumanSummary({
      what: "值得注意的是，这张卡要做走查。",
      where: "第二轮梳理已完成，综上所述还差一步。",
      blockedNext: "Importantly, round 3 will delve into it.",
      evidence: [{ label: "总的来说，这不是分歧", where: "x" }],
    });
    expect(hits).toEqual(expect.arrayContaining([
      "值得注意的是", "综上所述", "总的来说", "不是分歧", "第N轮", "importantly", "delve", "round N",
    ]));
  });

  it("exempts evidence locators so a round-numbered section heading can be quoted verbatim", () => {
    const hits = lintTaskHumanSummary({
      ...CLEAN_SUMMARY,
      evidence: [{ label: "场景⑧的三个前端出口", where: "第二轮 Backlog 梳理 → 二、本轮新发现 → 表格" }],
    });
    expect(hits).toEqual([]);
  });
});

describe("parseTaskHumanSummaryResponse", () => {
  it("accepts raw JSON, fenced JSON and JSON with prose around it", () => {
    const json = JSON.stringify(CLEAN_SUMMARY);
    expect(parseTaskHumanSummaryResponse(json)).toEqual(CLEAN_SUMMARY);
    expect(parseTaskHumanSummaryResponse(`\`\`\`json\n${json}\n\`\`\``)).toEqual(CLEAN_SUMMARY);
    expect(parseTaskHumanSummaryResponse(`Here you go:\n${json}\nThanks.`)).toEqual(CLEAN_SUMMARY);
  });

  it("accepts snake_case blocked_next and drops evidence without a label", () => {
    const parsed = parseTaskHumanSummaryResponse(JSON.stringify({
      what: "a", where: "b", blocked_next: "c",
      evidence: [{ label: "ok", where: "x" }, { where: "no label" }, "junk"],
    }));
    expect(parsed).toEqual({ what: "a", where: "b", blockedNext: "c", evidence: [{ label: "ok", where: "x" }] });
  });

  it("returns null when a prose field is missing", () => {
    expect(parseTaskHumanSummaryResponse(JSON.stringify({ what: "a", where: "b" }))).toBeNull();
    expect(parseTaskHumanSummaryResponse("not json")).toBeNull();
  });
});

describe("buildTaskHumanSummaryPrompt", () => {
  it("embeds facts, the description and the banned list; adds retry note when hits are given", () => {
    const facts = extractTaskHumanSummaryFacts({ title: "x", objective: HEAVY_DESCRIPTION, columnId: "review" });
    const prompt = buildTaskHumanSummaryPrompt({ language: "zh-CN", facts, description: HEAVY_DESCRIPTION });
    expect(prompt).toContain("值得注意的是、综上所述、总的来说");
    expect(prompt).toContain("- AC1: 场景 ⑧ 复走查");
    expect(prompt).toContain("<<<DESCRIPTION");
    expect(prompt).not.toContain("上一版命中了黑名单");

    const retry = buildTaskHumanSummaryPrompt({
      language: "zh-CN", facts, description: HEAVY_DESCRIPTION, previousLintHits: ["综上所述"],
    });
    expect(retry).toContain("上一版命中了黑名单：综上所述");
  });

  it("truncates an oversized description", () => {
    const facts = extractTaskHumanSummaryFacts({ title: "x", objective: "short" });
    const prompt = buildTaskHumanSummaryPrompt({
      language: "en", facts, description: "y".repeat(100), maxDescriptionChars: 10,
    });
    expect(prompt).toContain("yyyyyyyyyy\n\n[truncated]");
  });
});

describe("generateTaskHumanSummary", () => {
  const input = {
    taskId: "task-1",
    title: "x",
    objective: HEAVY_DESCRIPTION,
    columnId: "review",
    language: "zh-CN" as const,
  };

  it("returns a record with hash, model and zero lint hits when the first draft is clean", async () => {
    const generate = vi.fn(async () => ({ text: JSON.stringify(CLEAN_SUMMARY), model: "m1" }));
    const record = await generateTaskHumanSummary(input, generate, () => new Date("2026-09-21T00:00:00Z"));

    expect(generate).toHaveBeenCalledTimes(1);
    expect(record).toMatchObject({
      taskId: "task-1",
      descriptionHash: hashTaskDescription(HEAVY_DESCRIPTION),
      language: "zh-CN",
      model: "m1",
      generatedAt: "2026-09-21T00:00:00.000Z",
      summary: CLEAN_SUMMARY,
      lintHits: [],
    });
  });

  it("retries exactly once with the hits fed back when the first draft trips the lint", async () => {
    const dirty = { ...CLEAN_SUMMARY, what: "值得注意的是，这张卡要做走查。" };
    const generate = vi.fn()
      .mockResolvedValueOnce({ text: JSON.stringify(dirty), model: "m1" })
      .mockResolvedValueOnce({ text: JSON.stringify(CLEAN_SUMMARY), model: "m1" });

    const record = await generateTaskHumanSummary(input, generate);

    expect(generate).toHaveBeenCalledTimes(2);
    expect(String(generate.mock.calls[1]?.[0])).toContain("上一版命中了黑名单：值得注意的是");
    expect(record.summary).toEqual(CLEAN_SUMMARY);
    expect(record.lintHits).toEqual([]);
  });

  it("keeps the second draft and reports remaining hits when the retry still trips", async () => {
    const dirty = { ...CLEAN_SUMMARY, what: "值得注意的是，综上所述。" };
    const lessDirty = { ...CLEAN_SUMMARY, what: "综上所述。" };
    const generate = vi.fn()
      .mockResolvedValueOnce({ text: JSON.stringify(dirty), model: "m1" })
      .mockResolvedValueOnce({ text: JSON.stringify(lessDirty), model: "m1" });

    const record = await generateTaskHumanSummary(input, generate);
    expect(record.summary).toEqual(lessDirty);
    expect(record.lintHits).toEqual(["综上所述"]);
  });

  it("throws a typed error on empty or unparseable responses", async () => {
    await expect(generateTaskHumanSummary(input, async () => ({ text: "   ", model: "m" })))
      .rejects.toMatchObject({ code: "empty_response" });
    await expect(generateTaskHumanSummary(input, async () => ({ text: "no json here", model: "m" })))
      .rejects.toBeInstanceOf(TaskHumanSummaryGenerationError);
    await expect(generateTaskHumanSummary(input, async () => { throw new Error("boom"); }))
      .rejects.toMatchObject({ code: "provider", message: "boom" });
  });
});

describe("FileTaskHumanSummaryStore", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips a record per (taskId, language) and returns null for misses / corrupt files", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "routa-human-summary-"));
    dirs.push(dir);
    const store = new FileTaskHumanSummaryStore(dir);
    const record = {
      taskId: "task/with:odd chars",
      descriptionHash: "abc",
      language: "zh-CN" as const,
      model: "m",
      generatedAt: "2026-09-21T00:00:00.000Z",
      summary: CLEAN_SUMMARY,
      lintHits: [],
    };

    expect(await store.get(record.taskId, "zh-CN")).toBeNull();
    await store.save(record);
    expect(await store.get(record.taskId, "zh-CN")).toEqual(record);
    expect(await store.get(record.taskId, "en")).toBeNull();

    const files = fs.readdirSync(dir);
    expect(files).toHaveLength(1);
    fs.writeFileSync(path.join(dir, files[0]!), "{not json");
    expect(await store.get(record.taskId, "zh-CN")).toBeNull();
  });
});
