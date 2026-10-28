/** Card 7fbfba57: reason text parsing (summary line / Findings section / first paragraph). */
import { describe, expect, it } from "vitest";
import { parseInboxReason } from "../inbox-reason";

const NO_MD = (text: string) => {
  expect(text).not.toMatch(/(^|\s)#{1,6}\s/u);
  expect(text).not.toMatch(/\*\*|`/u);
  expect(text).not.toMatch(/^[-*>]\s/u);
};

describe("C1 summary line", () => {
  it.each<[string, string, string, string | null]>([
    ["① full-width bar", "阻塞原因：A｜需要你定：B", "A", "B"],
    ["② half-width bar", "阻塞原因：A | 需要你定：B", "A", "B"],
    ["③ English", "Blocked because: A | Needs your decision: B", "A", "B"],
    ["④a bold", "**阻塞原因**：A｜**需要你定**：B", "A", "B"],
    ["④b quote", "> 阻塞原因：A｜需要你定：B", "A", "B"],
    ["④c list", "- 阻塞原因：A｜需要你定：B", "A", "B"],
    ["⑤ bar inside why", "阻塞原因：A1 | A2｜需要你定：B", "A1 | A2", "B"],
    ["⑥ why only", "阻塞原因：A", "A", null],
    ["summary below a heading", "## Review Findings\n- **Verdict**: BLOCKED\n\n阻塞原因：A｜需要你定：B", "A", "B"],
  ])("%s", (_name, body, why, decision) => {
    const result = parseInboxReason(body);
    expect(result.why).toBe(why);
    expect(result.decision).toBe(decision);
    expect(result.text).toBe(why);
    expect(result.full).toBe(body);
  });
});

const OLD_ZH = [
  "## Review Findings",
  "- **Verdict**: BLOCKED",
  "",
  "**AC Status**",
  "| AC | 结论 |",
  "|---|---|",
  "| AC1 | 过 |",
  "",
  "### 发现的问题",
  "",
  "| 命令 | 退出码 |",
  "- 验证命令在干净主干上也失败，属基线失败",
  "- 其他",
].join("\n");
const OLD_EN = OLD_ZH.replace("### 发现的问题", "### Findings");

describe("C2 old Findings comment", () => {
  it.each([["zh", OLD_ZH], ["en", OLD_EN]])("%s", (_name, body) => {
    const result = parseInboxReason(body);
    expect(result.why).toBe("验证命令在干净主干上也失败，属基线失败");
    expect(result.why).not.toMatch(/Review Findings|Verdict|AC Status/u);
    expect(result.decision).toBeNull();
  });
  it("a Findings heading without body falls back to the first paragraph", () => {
    expect(parseInboxReason("## Review Findings\n- **Verdict**: BLOCKED\n\n### 发现的问题\n| a | b |").why).toBe("Review Findings Verdict: BLOCKED");
  });
});

const REAL_SHAPE = [
  "## Review Findings",
  "- **Verdict**: BLOCKED（不是 REJECTED：卡上唯一验证命令失败）",
  "- **AC Status**（按卡正文 YAML）:",
  "  - AC1: ✅ 通过",
  "- **Verification Commands Re-run**:",
  "  - `go test ./...` → exit 1",
  "- **Issues found**:",
  "  1. 验证命令本身不能过：gofmt 段被 3 个原有文件拖红",
  "  2. 其他",
].join("\n");

describe("C2 real card shape (Issues found list item)", () => {
  it("takes the first numbered item under the label", () => {
    const result = parseInboxReason(REAL_SHAPE);
    expect(result.why.startsWith("验证命令本身不能过")).toBe(true);
    expect(result.why).not.toMatch(/Review Findings|Verdict|AC Status/u);
  });
  it("takes inline content after the label", () => {
    expect(parseInboxReason("## Review Findings\n- **Verdict**: BLOCKED\n- **发现的问题**：端口被占用").why).toBe("端口被占用");
  });
  it("APPROVED style 'Issues found: None' falls back to the first paragraph", () => {
    const result = parseInboxReason("## Review Findings\n- **Verdict**: APPROVED\n- **Issues found**: None");
    expect(result.why).not.toBe("None");
    expect(result.why).toMatch(/Verdict/u);
  });
});

describe("C3 markdown stripped, full verbatim", () => {
  it.each<[string, string]>([
    ["summary", "> **阻塞原因**：`x` 失败\n｜需要你定：\n"],
    ["findings", "## Review Findings\n\n### 发现的问题\n- **坏了** `git push` 失败\n  续行"],
    ["first paragraph", "## 标题\n- **粗** `代码`\n* 星号\n> 引用\n\n第二段"],
  ])("%s", (_name, body) => {
    const result = parseInboxReason(body);
    NO_MD(result.why);
    expect(result.why).not.toContain("\n");
    expect(result.full).toBe(body);
  });
});

describe("C12 edges", () => {
  it("plain text keeps the first paragraph", () => {
    expect(parseInboxReason("推送冲突\n\n详情").why).toBe("推送冲突");
  });
  it("whitespace-only does not crash", () => {
    expect(parseInboxReason("   ")).toMatchObject({ why: "", decision: null });
  });
});

describe("F3 random cross-check (10,000 cases)", () => {
  function mulberry(seed: number) {
    let a = seed;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function run(parse: (body: string) => { why: string; decision: string | null }, count: number) {
    const rnd = mulberry(0xfbfba57 & 0xffffff);
    const pick = <T,>(list: T[]) => list[Math.floor(rnd() * list.length)];
    let mismatches = 0;
    for (let i = 0; i < count; i += 1) {
      const kind = pick(["summary", "findings", "plain"]);
      const noise = pick(["", "> ", "- ", "* "]);
      const bold = pick([false, true]);
      const why = `原因${i}${pick(["", " | 带竖线", "，含 x"])}`;
      const decision = pick([`定${i}`, null]);
      const lead = pick(["", "## Review Findings\n- **Verdict**: BLOCKED\n\n", "| a | b |\n\n"]);
      let body: string;
      let expected: { why: string; decision: string | null };
      if (kind === "summary") {
        const zh = rnd() < 0.5;
        const sep = pick(["｜", " | "]);
        const label = zh ? "阻塞原因" : "Blocked because";
        const dlabel = zh ? "需要你定" : "Needs your decision";
        const l = bold ? `**${label}**` : label;
        const d = bold ? `**${dlabel}**` : dlabel;
        body = `${lead}${noise}${l}：${why}${decision ? `${sep}${d}：${decision}` : ""}\n\n后文`;
        expected = { why, decision };
      } else if (kind === "findings") {
        const h = pick(["### 发现的问题", "### Findings", "**发现的问题**", "- **Issues found**:"]);
        const items = pick(["\n\n| t | u |\n", "\n  1. "]);
        const mark = items.includes("1.") ? "" : noise;
        body = `${lead}${h}${items}${mark}**${why}** \`c\`\n- 次要`;
        expected = { why: `${why} c`, decision: null };
      } else {
        body = `${noise}${why}\n续\n\n第二段`;
        expected = { why: `${why} 续`, decision: null };
      }
      if (kind === "summary" && lead.includes("| a | b |") && !decision) {
        // table line above, still summary
      }
      const got = parse(body);
      if (got.why !== expected.why || got.decision !== expected.decision) mismatches += 1;
    }
    return mismatches;
  }
  it("matches the generator's expectations", () => {
    expect(run(parseInboxReason, 10_000)).toBe(0);
  });
  it("catches a planted bug: first-paragraph-only parser", () => {
    expect(run((body) => ({ why: body.split(/\n\s*\n/u, 1)[0], decision: null }), 2_000)).toBeGreaterThan(0);
  });
});
