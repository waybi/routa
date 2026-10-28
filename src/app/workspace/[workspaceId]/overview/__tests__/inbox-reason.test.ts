/** Card 7fbfba57: reason text parsing (summary line / Findings section / first paragraph). */
import { describe, expect, it } from "vitest";
import { parseInboxReason } from "../inbox-reason";

const NO_MD = (text: string) => {
  expect(text).not.toMatch(/(^|\s)#{1,6}\s/u);
  expect(text).not.toMatch(/\*\*|`/u);
  expect(text).not.toMatch(/^[-*>]\s/u);
};

const S1_WHY = "上线前有一项老检查没过，不是这张卡的问题";
const S1_ACT = "不用你管：AI 正在修这项检查，修好后这张卡自动上线。";
const S2_WHY = "改的代码和别人刚上线的改动冲突了";
const S2_ACT = "要你定：先撤掉别人的改动，还是等它合并完再上";

describe("C1 two-line summary", () => {
  it.each<[string, string, string, string | null]>([
    ["① boss sample 1", `阻塞原因：${S1_WHY}\n${S1_ACT}`, S1_WHY, S1_ACT],
    ["② boss sample 2", `阻塞原因：${S2_WHY}\n${S2_ACT}`, S2_WHY, S2_ACT],
    ["③a English decide", "Blocked because: X\nYou decide: Y", "X", "You decide: Y"],
    ["③b English no action", "Blocked because: X\nNo action needed: Y", "X", "No action needed: Y"],
    ["④ review bounce marker first", `【评审打回 第 2 次】\n阻塞原因：${S1_WHY}\n${S1_ACT}\n\n细节`, S1_WHY, S1_ACT],
    ["⑤ markdown noise, mixed colons", `> **阻塞原因**:${S2_WHY}\n- **要你定**：先撤掉，还是等`, S2_WHY, "要你定：先撤掉，还是等"],
    ["⑥ second line is plain detail", "阻塞原因：A\n细节说明\n要你定：B", "A", null],
    ["⑦ blank line between", `阻塞原因：A\n\n${S1_ACT}`, "A", S1_ACT],
    ["only first line", "阻塞原因：A", "A", null],
  ])("%s", (_name, body, headline, action) => {
    const result = parseInboxReason(body);
    expect(result.headline).toBe(headline);
    expect(result.action).toBe(action);
    expect(result.text).toBe(headline);
    expect(result.full).toBe(body);
    NO_MD(result.headline);
    if (result.action) NO_MD(result.action);
  });
});

describe("C2 older one-line shape", () => {
  it.each<[string, string, string, string]>([
    ["① full-width bar", "阻塞原因：A｜需要你定：B", "A", "需要你定：B"],
    ["② half-width bar", "阻塞原因：A | 需要你定：B", "A", "需要你定：B"],
    ["③ English", "Blocked because: A | Needs your decision: B", "A", "Needs your decision: B"],
    ["④a bold", "**阻塞原因**：A｜**需要你定**：B", "A", "需要你定：B"],
    ["④b quote", "> 阻塞原因：A｜需要你定：B", "A", "需要你定：B"],
    ["④c list", "- 阻塞原因：A｜需要你定：B", "A", "需要你定：B"],
    ["⑤ bar inside why", "阻塞原因：A1 | A2｜需要你定：B", "A1 | A2", "需要你定：B"],
    ["⑥ nothing to decide", "阻塞原因：A｜需要你定：无，AI 会自行处理", "A", "需要你定：无，AI 会自行处理"],
    ["below a heading", "## Review Findings\n- **Verdict**: BLOCKED\n\n阻塞原因：A｜需要你定：B", "A", "需要你定：B"],
  ])("%s", (_name, body, headline, action) => {
    const result = parseInboxReason(body);
    expect(result.headline).toBe(headline);
    expect(result.action).toBe(action);
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

describe("C2 older Findings comment", () => {
  it.each([["zh", OLD_ZH], ["en", OLD_EN]])("%s", (_name, body) => {
    const result = parseInboxReason(body);
    expect(result.headline).toBe("验证命令在干净主干上也失败，属基线失败");
    expect(result.headline).not.toMatch(/Review Findings|Verdict|AC Status/u);
    expect(result.action).toBeNull();
  });
  it("a Findings heading without body falls back to the first paragraph", () => {
    expect(parseInboxReason("## Review Findings\n- **Verdict**: BLOCKED\n\n### 发现的问题\n| a | b |").headline).toBe("Review Findings Verdict: BLOCKED");
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
    expect(result.headline.startsWith("验证命令本身不能过")).toBe(true);
    expect(result.headline).not.toMatch(/Review Findings|Verdict|AC Status/u);
  });
  it("takes inline content after the label", () => {
    expect(parseInboxReason("## Review Findings\n- **Verdict**: BLOCKED\n- **发现的问题**：端口被占用").headline).toBe("端口被占用");
  });
  it("APPROVED style 'Issues found: None' falls back to the first paragraph", () => {
    const result = parseInboxReason("## Review Findings\n- **Verdict**: APPROVED\n- **Issues found**: None");
    expect(result.headline).not.toBe("None");
    expect(result.headline).toMatch(/Verdict/u);
  });
});

describe("C3 markdown stripped, full verbatim", () => {
  it.each<[string, string]>([
    ["summary", "> **阻塞原因**：`x` 失败\n｜需要你定：\n"],
    ["findings", "## Review Findings\n\n### 发现的问题\n- **坏了** `git push` 失败\n  续行"],
    ["first paragraph", "## 标题\n- **粗** `代码`\n* 星号\n> 引用\n\n第二段"],
  ])("%s", (_name, body) => {
    const result = parseInboxReason(body);
    NO_MD(result.headline);
    expect(result.headline).not.toContain("\n");
    expect(result.full).toBe(body);
  });
});

describe("C12 edges", () => {
  it("plain text keeps the first paragraph", () => {
    expect(parseInboxReason("推送冲突\n\n详情").headline).toBe("推送冲突");
  });
  it("whitespace-only does not crash", () => {
    expect(parseInboxReason("   ")).toMatchObject({ headline: "", action: null });
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
  type Got = { headline: string; action: string | null };
  function run(parse: (body: string) => Got, count: number) {
    const rnd = mulberry(0xfbfba57 & 0xffffff);
    const pick = <T,>(list: T[]) => list[Math.floor(rnd() * list.length)];
    let mismatches = 0;
    for (let i = 0; i < count; i += 1) {
      const kind = pick(["two", "legacy", "whyonly", "findings", "plain"]);
      const noise = pick(["", "> ", "- ", "* "]);
      const bold = pick([false, true]);
      const why = `原因${i}${pick(["", " | 带竖线", "，含 x"])}`;
      const lead = pick(["", "## Review Findings\n- **Verdict**: BLOCKED\n\n", "| a | b |\n\n", "【评审打回 第 1 次】\n"]);
      const zh = rnd() < 0.5;
      const label = zh ? "阻塞原因" : "Blocked because";
      const l = bold ? `**${label}**` : label;
      const colon = pick(["：", ":"]);
      let body: string;
      let expected: Got;
      if (kind === "two") {
        const act = pick(zh ? ["不用你管", "要你定"] : ["No action needed", "You decide"]) + `：定${i}`;
        const gap = pick(["\n", "\n\n"]);
        body = `${lead}${noise}${l}${colon}${why}${gap}${noise}${act}\n细节 ${i}`;
        expected = { headline: why, action: act };
      } else if (kind === "legacy") {
        const dlabel = zh ? "需要你定" : "Needs your decision";
        const sep = pick(["｜", " | "]);
        const d = bold ? `**${dlabel}**` : dlabel;
        body = `${lead}${noise}${l}${colon}${why}${sep}${d}：定${i}\n\n后文`;
        expected = { headline: why, action: `${dlabel}${zh ? "：" : ": "}定${i}` };
      } else if (kind === "whyonly") {
        body = `${lead}${noise}${l}${colon}${why}\n细节 ${i}\n要你定：不该当第二行`;
        expected = { headline: why, action: null };
      } else if (kind === "findings") {
        const h = pick(["### 发现的问题", "### Findings", "**发现的问题**", "- **Issues found**:"]);
        const items = pick(["\n\n| t | u |\n", "\n  1. "]);
        const mark = items.includes("1.") ? "" : noise;
        body = `${lead.startsWith("【") ? "" : lead}${h}${items}${mark}**${why}** \`c\`\n- 次要`;
        expected = { headline: `${why} c`, action: null };
      } else {
        body = `${noise}${why}\n续\n\n第二段`;
        expected = { headline: `${why} 续`, action: null };
      }
      const got = parse(body);
      if (got.headline !== expected.headline || got.action !== expected.action) mismatches += 1;
    }
    return mismatches;
  }
  it("matches the generator's expectations", () => {
    expect(run(parseInboxReason, 10_000)).toBe(0);
  });
  it("catches a planted bug: first-paragraph-only parser", () => {
    expect(run((body) => ({ headline: body.split(/\n\s*\n/u, 1)[0], action: null }), 2_000)).toBeGreaterThan(0);
  });
});
