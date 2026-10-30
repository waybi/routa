// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildTaskPrompt,
  resolveKanbanAutomationProvider,
  resolveSessionModelSelection,
  triggerAssignedTaskAgent,
} from "../agent-trigger";
import { buildStructuredAcceptanceCriteriaLines } from "../acceptance-criteria-prompt";
import { resolveKanbanAutomationStep } from "../effective-task-automation";
import { createTask } from "../../models/task";
import type { KanbanAutomationStep, KanbanColumn } from "../../models/kanban";
import { AgentEventType, type EventBus } from "../../events/event-bus";
import { saveReasoningMemory } from "@/core/harness/reasoning-memory";

const { dispatchSessionPromptMock } = vi.hoisted(() => ({
  dispatchSessionPromptMock: vi.fn(),
}));

vi.mock("../../acp/claude-code-sdk-adapter", () => ({
  isClaudeCodeSdkConfigured: vi.fn(),
}));

vi.mock("@/core/acp/session-prompt", () => ({
  dispatchSessionPrompt: dispatchSessionPromptMock,
}));

const sendMessageMock = vi.fn();
const waitForCompletionMock = vi.fn();

vi.mock("../../a2a", () => ({
  getA2AOutboundClient: vi.fn(() => ({
    sendMessage: sendMessageMock,
    waitForCompletion: waitForCompletionMock,
  })),
}));

import { isClaudeCodeSdkConfigured } from "../../acp/claude-code-sdk-adapter";

const twoStepReviewColumns: KanbanColumn[] = [
  { id: "dev", name: "Dev", position: 0, stage: "dev" },
  {
    id: "review",
    name: "Review",
    position: 1,
    stage: "review",
    automation: {
      enabled: true,
      steps: [
        { id: "qa-frontend", role: "GATE", specialistId: "kanban-qa-frontend", specialistName: "QA Frontend" },
        { id: "review-guard", role: "GATE", specialistId: "kanban-review-guard", specialistName: "Review Guard" },
      ],
      requiredArtifacts: ["screenshot", "test_results"],
    },
  },
  { id: "done", name: "Done", position: 2, stage: "done" },
];

/** Review card whose triggerSessionId still points at the finished QA Frontend step. */
function buildReviewTaskAfterQaFrontend(assignedStep: "qa" | "guard") {
  return {
    ...createTask({
      id: "task-review-steps",
      title: "Two-step review",
      objective: "QA Frontend then Review Guard",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "review",
      assignedProvider: "codex",
      assignedRole: "GATE",
      assignedSpecialistId: assignedStep === "guard" ? "kanban-review-guard" : "kanban-qa-frontend",
      assignedSpecialistName: assignedStep === "guard" ? "Review Guard" : "QA Frontend",
      triggerSessionId: "session-qa-frontend",
    }),
    laneSessions: [{
      sessionId: "session-qa-frontend",
      columnId: "review",
      stepIndex: 0,
      stepId: "qa-frontend",
      role: "GATE",
      specialistId: "kanban-qa-frontend",
      status: "completed" as const,
      startedAt: "2026-10-15T00:00:00.000Z",
    }],
  };
}

function storyYaml(ids: string[]): string {
  const acs = ids.map((id) => `    - id: ${id}\n      text: "text of ${id}"\n      testable: true`).join("\n");
  const inv = ["independent", "negotiable", "valuable", "estimable", "small", "testable"]
    .map((k) => `    ${k}:\n      status: pass\n      reason: "ok"`)
    .join("\n");
  return [
    "Intro line",
    "",
    "```yaml",
    "story:",
    "  version: 1",
    "  language: zh-CN",
    '  title: "t"',
    '  problem_statement: "p"',
    '  user_value: "v"',
    "  acceptance_criteria:",
    acs,
    "  constraints_and_affected_areas:",
    '    - "a"',
    "  dependencies_and_sequencing:",
    "    independent_story_check: pass",
    "    depends_on: []",
    '    unblock_condition: "none"',
    "  out_of_scope:",
    '    - "o"',
    "  invest:",
    inv,
    "```",
    "",
    "END-OF-OBJECTIVE",
  ].join("\n");
}

const AC_HEADING = "## Acceptance Criteria（结构化字段，评审以此为准）";
const range = (n: number) => Array.from({ length: n }, (_, i) => `AC${i + 1}`);

function acTask(opts: { objective: string; acceptanceCriteria?: string[]; columnId?: string }) {
  return createTask({
    id: "task-ac",
    title: "AC field",
    objective: opts.objective,
    acceptanceCriteria: opts.acceptanceCriteria,
    workspaceId: "default",
    boardId: "board-1",
    columnId: opts.columnId ?? "dev",
  });
}

describe("structured AC numbering (L256)", () => {
  const items = (input: string[], objective?: string) =>
    buildStructuredAcceptanceCriteriaLines(input, objective).filter((l) => l.startsWith("- "));

  it("AC1: numbers unnumbered items in order", () => {
    expect(items(["甲", "乙", "丙", "丁"])).toEqual(["- AC-1: 甲", "- AC-2: 乙", "- AC-3: 丙", "- AC-4: 丁"]);
  });
  it("AC2: mixed keeps numbered, no collision", () => {
    expect(items(["x", "AC3: y", "z"])).toEqual(["- AC-1: x", "- AC3: y", "- AC-2: z"]);
    expect(items(["AC-1: a", "b"])).toEqual(["- AC-1: a", "- AC-2: b"]);
    expect(items(["AC1 正文", "b"])).toEqual(["- AC1 正文", "- AC-2: b"]);
    expect(items(["AC2: a", "b", "c"])).toEqual(["- AC2: a", "- AC-1: b", "- AC-3: c"]);
    expect(items(["AC10: a", "b"])).toEqual(["- AC10: a", "- AC-1: b"]);
  });
  it("AC2: all numbered stay verbatim", () => {
    const all = ["AC3: y", "AC-a 字母号", "AC1 正文", "ac2：小写全角"];
    expect(items(all)).toEqual(all.map((a) => `- ${a}`));
  });
  it("AC2: English words are not treated as numbered", () => {
    expect(items(["Accept 按钮可点", "ACME 接口", "ACa: 无短横字母号"])).toEqual([
      "- AC-1: Accept 按钮可点", "- AC-2: ACME 接口", "- AC-3: ACa: 无短横字母号",
    ]);
  });
  it("AC3: input not mutated; YAML warning reads raw items", () => {
    const input = ["x", "AC3: y", "z"];
    const clone = structuredClone(input);
    buildStructuredAcceptanceCriteriaLines(input, undefined);
    expect(input).toEqual(clone);
    const none = buildStructuredAcceptanceCriteriaLines(["a", "b", "c", "d"], storyYaml(["AC1", "AC2", "AC3", "AC4"])).join("\n");
    expect(none).not.toContain("缺少");
    const some = buildStructuredAcceptanceCriteriaLines(["AC1: a", "AC3: c"], storyYaml(["AC1", "AC2"])).join("\n");
    expect(some).toContain("canonical YAML 缺少 AC3");
  });
  it("edge: blank/leading whitespace/two digits", () => {
    expect(items(["", "  x", "  AC3: y"])).toEqual(["- AC-1: x", "-   AC3: y"]);
    expect(items(Array.from({ length: 12 }, (_, i) => `t${i}`)).at(-1)).toBe("- AC-12: t11");
    expect(buildStructuredAcceptanceCriteriaLines([], undefined)).toEqual([]);
  });
  it("path: buildTaskPrompt shows AC-1", () => {
    const prompt = buildTaskPrompt(createTask({ id: "t-n", title: "t", objective: "o", acceptanceCriteria: ["无编号"], workspaceId: "default", boardId: "b", columnId: "dev" }));
    expect(prompt).toContain("- AC-1: 无编号");
  });
});

describe("buildTaskPrompt structured acceptance criteria (retro L256)", () => {
  it("C1: lists all 10 field ACs and flags AC10 missing from the YAML, between objective and Story Readiness", () => {
    const fieldAcs = range(10).map((id) => `${id}: 条目 ${id} 的原文`);
    const task = acTask({ objective: storyYaml(range(9)), acceptanceCriteria: fieldAcs });
    const prompt = buildTaskPrompt(task, [], { summaryContext: { storyReadiness: { ready: true, requiredTaskFields: [], missing: [], checks: { scope: true, acceptanceCriteria: true, verificationCommands: true, testCases: true, verificationPlan: true, dependenciesDeclared: true } } } } as never);
    for (const ac of fieldAcs) expect(prompt).toContain(`- ${ac}`);
    const hint = prompt.split("\n").find((line) => line.includes("canonical YAML 缺少"));
    expect(hint).toBeDefined();
    expect(hint!.match(/AC\d+/g)).toEqual(["AC10"]);
    expect(hint).toContain("以本节结构化字段为准");
    const objEnd = prompt.indexOf("END-OF-OBJECTIVE");
    const heading = prompt.indexOf(AC_HEADING);
    expect(objEnd).toBeGreaterThan(-1);
    expect(heading).toBeGreaterThan(objEnd);
    const readiness = prompt.indexOf("## Story Readiness");
    expect(readiness).toBeGreaterThan(-1);
    expect(heading).toBeLessThan(readiness);
  });

  it("C2: no hint when field and YAML ids match", () => {
    const prompt = buildTaskPrompt(acTask({ objective: storyYaml(range(5)), acceptanceCriteria: range(5).map((id) => `${id}: x`) }));
    expect(prompt).toContain(AC_HEADING);
    expect(prompt).not.toContain("缺少");
  });

  it.each([[undefined], [[]], [["", "  "]]])("C3: no section for empty field %j", (field) => {
    const prompt = buildTaskPrompt(acTask({ objective: storyYaml(range(3)), acceptanceCriteria: field as string[] | undefined }));
    expect(prompt).not.toContain(AC_HEADING);
  });

  it("C3: blank entries skipped, id-less entries listed but not compared", () => {
    const prompt = buildTaskPrompt(acTask({ objective: storyYaml(range(2)), acceptanceCriteria: ["AC1: a", "", "补充：界面无改动"] }));
    expect(prompt).toContain("- AC-2: 补充：界面无改动");
    expect(prompt).not.toContain("\n- \n");
    expect(prompt).not.toContain("缺少");
  });

  it.each([["no yaml block", "plain objective"], ["broken yaml", "```yaml\nstory:\n  acceptance_criteria: nope\n bad: [\n```"]])(
    "C4: %s lists field text without hint or throw",
    (_name, objective) => {
      let prompt = "";
      expect(() => { prompt = buildTaskPrompt(acTask({ objective, acceptanceCriteria: ["AC1: a", "AC10: b"] })); }).not.toThrow();
      expect(prompt).toContain(AC_HEADING);
      expect(prompt).toContain("- AC10: b");
      expect(prompt).not.toContain("缺少");
    },
  );

  it.each([["AC10：全角冒号"], ["AC10 : 冒号前有空格"], ["  AC10: 行首空格"]])("C5: recognises %j", (item) => {
    const prompt = buildTaskPrompt(acTask({ objective: storyYaml(range(9)), acceptanceCriteria: [item] }));
    expect(prompt).toContain(`- ${item}`);
    expect(prompt.split("\n").find((l) => l.includes("缺少"))!.match(/AC\d+/g)).toEqual(["AC10"]);
  });

  it("C7: long entries are never truncated", () => {
    const items = range(10).map((id) => `${id}: ${"长句".repeat(700)}结尾-${id}`);
    const prompt = buildTaskPrompt(acTask({ objective: storyYaml(range(9)), acceptanceCriteria: items }));
    for (const item of items) expect(prompt).toContain(item);
  });

  it("C11: YAML having extra ids does not trigger the hint", () => {
    const prompt = buildTaskPrompt(acTask({ objective: storyYaml(range(11)), acceptanceCriteria: range(10).map((id) => `${id}: x`) }));
    expect(prompt).not.toContain("缺少");
  });

  it.each(["backlog", "todo", "dev", "review", "done"])("F4: column %s shows section and hint", (columnId) => {
    const prompt = buildTaskPrompt(acTask({ columnId, objective: storyYaml(range(9)), acceptanceCriteria: range(10).map((id) => `${id}: x`) }));
    expect(prompt).toContain(AC_HEADING);
    expect(prompt).toContain("canonical YAML 缺少 AC10");
  });
});

describe("buildTaskPrompt", () => {
  it("keeps backlog automation in planning mode", () => {
    const task = createTask({
      id: "task-1",
      title: "echo hello world",
      objective: "echo hello world",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "backlog",
    });

    const prompt = buildTaskPrompt(task);

    expect(prompt).toContain("Treat backlog as planning and refinement, not implementation");
    expect(prompt).toContain("move_card");
    expect(prompt).toContain("Do NOT create or sync GitHub issues during backlog planning.");
    expect(prompt).toContain("Prefer feature-tree confirmation first");
    expect(prompt).toContain("You may use read-only native tools such as Read, Grep, and Glob for limited repo inspection only after feature-tree evidence is still weak or ambiguous");
    expect(prompt).toContain("If Relevant History Memory or Relevant Feature Tree Context is provided");
    expect(prompt).toContain("confirm_feature_tree_story_context");
    expect(prompt).toContain('taskId: "task-1"');
    expect(prompt).toContain("Only write contextSearchSpec after feature-tree confirmation or repo inspection confirms the feature/files");
    expect(prompt).toContain("include an optional `feature_tree` block");
    expect(prompt).toContain("decompose_tasks");
    expect(prompt).not.toContain("Complete the work assigned to this column stage");
  });

  it("keeps dev automation in implementation mode", () => {
    const task = createTask({
      id: "task-2",
      title: "Implement login form",
      objective: "Build the login screen",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "dev",
    });

    const prompt = buildTaskPrompt(task);

    expect(prompt).toContain("Complete the work assigned to this column stage");
    expect(prompt).toContain("Start with direct task-scoped tools such as `list_artifacts`, `update_task`, `update_card`, `create_note`, and `move_card`");
    expect(prompt).toContain("move_card");
    expect(prompt).toContain("update_card is not a story-readiness tool");
    expect(prompt).toContain("targetColumnId: \"review\"");
    expect(prompt).toContain("**Board ID:** board-1");
    expect(prompt).toContain("**Current Column ID:** dev");
    expect(prompt).toContain("**Next Column ID:** review");
    expect(prompt).toContain("Only call `get_board` if you truly need whole-board state, and if you do, pass boardId: \"board-1\"");
    expect(prompt).toContain("Do not call `report_to_parent`");
    expect(prompt).toContain("## Dev Verification Safety");
    expect(prompt).toContain("Do not assume `http://localhost:3000` is the right preview target");
    expect(prompt).toContain("`pkill -f \"next dev\"`");
    expect(prompt).toContain("Do not use `ps | grep | xargs kill`, `killall`, or broad `pkill` patterns for cleanup");
    expect(prompt).toContain("If the UI depends on env vars or setup");
    expect(prompt).not.toContain("Tool: report_to_parent");
  });

  it("injects saved per-lane experience memory into automation prompts", () => {
    const task = createTask({
      id: "task-lane-memory-prompt",
      title: "Continue review fix",
      objective: "Use prior review evidence",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "review",
    });
    task.jitContextSnapshot = {
      generatedAt: "2026-04-23T08:00:00.000Z",
      summary: "Recovered history context.",
      matchConfidence: "medium",
      matchReasons: [],
      warnings: [],
      matchedFileDetails: [],
      matchedSessionIds: [],
      failures: [],
      repeatedReadFiles: [],
      sessions: [],
      perLaneAnalysis: {
        review: {
          columnId: "review",
          columnName: "Review",
          synthesizedAt: "2026-04-23T08:10:00.000Z",
          sessionCount: 2,
          latestSessionId: "review-2",
          latestStatus: "running",
          completedSessions: 1,
          failedSessions: 1,
          recoveredSessions: 1,
          summary: "Review has 2 lane session(s): 1 completed or transitioned, 1 failed or timed out, 1 recovered. Latest session review-2 is running.",
          learnedPatterns: ["Recovery has been needed 1 time(s), most often for completion_criteria_not_met."],
          topFailures: ["review-1 ended as failed, recovery reason: completion_criteria_not_met."],
          recommendedActions: ["Review review-1 before retrying this lane to avoid repeating the same failure."],
          flowGuidance: [],
        },
      },
    };

    const prompt = buildTaskPrompt(task);

    expect(prompt).toContain("## Lane Experience Memory");
    expect(prompt).toContain("Review has 2 lane session");
    expect(prompt).toContain("Review review-1 before retrying this lane");
  });

  it("injects relevant strategy memory when the task has repo context", () => {
    const originalHome = process.env.HOME;
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "routa-reasoning-prompt-"));
    const repoRoot = path.join(tempHome, "repo");
    fs.mkdirSync(repoRoot, { recursive: true });

    try {
      process.env.HOME = tempHome;
      saveReasoningMemory(repoRoot, {
        title: "Preserve feature explorer route shape",
        content: "When changing Feature Explorer API behavior, keep the existing route contract and add focused contract tests before extracting helpers.",
        outcome: "success",
        featureIds: ["feature-explorer"],
        filePaths: ["src/app/api/feature-explorer/friction-profiles/route.ts"],
        lanes: ["dev"],
        providers: ["codex"],
        tags: ["api-parity"],
        confidence: 0.88,
        evidenceCount: 2,
      });

      const task = createTask({
        id: "task-reasoning-memory",
        title: "Update Feature Explorer friction profile API",
        objective: "Keep the Feature Explorer API route stable while adding parity checks.",
        workspaceId: "default",
        boardId: "board-1",
        columnId: "dev",
        assignedProvider: "codex",
        labels: ["api-parity"],
        contextSearchSpec: {
          query: "Feature Explorer friction profile API parity",
          featureCandidates: ["feature-explorer"],
          relatedFiles: ["src/app/api/feature-explorer/friction-profiles/route.ts"],
        },
      });
      task.jitContextSnapshot = {
        generatedAt: "2026-04-28T08:00:00.000Z",
        repoPath: repoRoot,
        featureId: "feature-explorer",
        summary: "Feature Explorer route work.",
        matchConfidence: "high",
        matchReasons: [],
        warnings: [],
        matchedFileDetails: [
          {
            filePath: "src/app/api/feature-explorer/friction-profiles/route.ts",
            changes: 2,
            sessions: 1,
            updatedAt: "2026-04-28T08:00:00.000Z",
          },
        ],
        matchedSessionIds: [],
        failures: [],
        repeatedReadFiles: [],
        sessions: [],
      };

      const prompt = buildTaskPrompt(task);

      expect(prompt).toContain("## Relevant Strategy Memory");
      expect(prompt).toContain("Preserve feature explorer route shape");
      expect(prompt).toContain("Outcome: success; confidence: 0.88");
      expect(prompt).toContain("feature:feature-explorer");
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it("does not invent a placeholder board id when the task has no board", () => {
    const task = createTask({
      id: "task-3",
      title: "Investigate flaky review check",
      objective: "Stabilize the review workflow",
      workspaceId: "default",
      columnId: "review",
    });

    const prompt = buildTaskPrompt(task);

    expect(prompt).toContain("**Board ID:** unavailable");
    expect(prompt).toContain("Only call `get_board` if the task context already provides a concrete boardId.");
    expect(prompt).not.toContain('boardId: "unknown"');
  });

  it("injects required artifact gates from the next transition into the prompt", () => {
    const task = createTask({
      id: "task-3",
      title: "Ship review-ready change",
      objective: "Implement and verify the change",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "dev",
    });

    const prompt = buildTaskPrompt(task, [
      { id: "dev", name: "Dev", position: 0, stage: "dev" },
      {
        id: "review",
        name: "Review",
        position: 1,
        stage: "review",
        automation: {
          enabled: true,
          requiredArtifacts: ["screenshot", "test_results"],
        },
      },
      { id: "done", name: "Done", position: 2, stage: "done" },
    ]);

    expect(prompt).toContain("## Artifact Gates");
    expect(prompt).toContain("Moving this card to Review requires Screenshot, Test Results.");
    expect(prompt).toContain("Before you call `move_card`, make sure Screenshot, Test Results exist as artifacts");
    expect(prompt).toContain("Use `list_artifacts`");
    expect(prompt).toContain("provide_artifact");
    expect(prompt).toContain("capture_screenshot");
    expect(prompt).toContain("update_card is not an artifact tool");
    expect(prompt).toContain("Do not treat `update_card` text as artifact evidence");
  });

  it("injects canonical contract gates from the next transition into the prompt", () => {
    const task = createTask({
      id: "task-contract-prompt",
      title: "Refine backlog contract",
      objective: "Clarify the story before todo.",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "backlog",
    });

    const prompt = buildTaskPrompt(task, [
      { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
      {
        id: "todo",
        name: "Todo",
        position: 1,
        stage: "todo",
        automation: {
          enabled: true,
          contractRules: {
            requireCanonicalStory: true,
            loopBreakerThreshold: 2,
          },
        },
      },
    ]);

    expect(prompt).toContain("## Contract Gates");
    expect(prompt).toContain("Moving this card to Todo requires one valid canonical ```yaml``` story contract");
    expect(prompt).toContain("call `update_card` with the full corrected description");
    expect(prompt).toContain("comments, progress notes, and completion summaries do not satisfy this contract gate");
    expect(prompt).toContain("Todo and downstream lanes will not silently repair malformed canonical YAML");
  });

  it("injects normalized readiness, INVEST, and evidence summaries into the prompt", () => {
    const task = createTask({
      id: "task-ctx-1",
      title: "Prepare implementation brief",
      objective: "Clarify the story before development",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "todo",
    });

    const prompt = buildTaskPrompt(task, [
      { id: "todo", name: "Todo", position: 0, stage: "todo" },
      { id: "dev", name: "Dev", position: 1, stage: "dev" },
    ], {
      summaryContext: {
        storyReadiness: {
          ready: false,
          missing: ["scope", "verification_plan"],
          requiredTaskFields: ["scope", "acceptance_criteria", "verification_plan"],
          checks: {
            scope: false,
            acceptanceCriteria: true,
            verificationCommands: false,
            testCases: true,
            verificationPlan: true,
            dependenciesDeclared: false,
          },
        },
        investValidation: {
          source: "heuristic",
          overallStatus: "warning",
          checks: {
            independent: { status: "pass", reason: "No blocking prerequisite was detected." },
            negotiable: { status: "warning", reason: "Human review still needed." },
            valuable: { status: "pass", reason: "Objective is clear enough." },
            estimable: { status: "warning", reason: "Scope is incomplete." },
            small: { status: "pass", reason: "Story remains narrow." },
            testable: { status: "pass", reason: "Test cases exist." },
          },
          issues: [],
        },
        evidenceSummary: {
          artifact: {
            total: 1,
            byType: { screenshot: 1 },
            requiredSatisfied: false,
            missingRequired: ["test_results"],
          },
          verification: {
            hasVerdict: false,
            hasReport: true,
          },
          completion: {
            hasSummary: false,
          },
          runs: {
            total: 2,
            latestStatus: "completed",
          },
        },
      },
    });

    expect(prompt).toContain("## Story Readiness");
    expect(prompt).toContain("Missing fields: scope, verification_plan");
    expect(prompt).toContain("call `update_task` to fill the structured task fields before you retry `move_card`");
    expect(prompt).toContain("## INVEST Snapshot");
    expect(prompt).toContain("Overall: WARNING");
    expect(prompt).toContain("## Evidence Bundle");
    expect(prompt).toContain("Missing required artifacts: test_results");
  });

  it("injects saved history memory into the task prompt when available", () => {
    const task = createTask({
      id: "task-history-memory",
      title: "Reuse Kanban history memory",
      objective: "Use prior memory before implementation",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "todo",
      jitContextSnapshot: {
        generatedAt: "2026-04-22T12:00:00.000Z",
        summary: "retrieval summary",
        matchConfidence: "high",
        matchReasons: ["shared feature"],
        warnings: [],
        matchedFileDetails: [],
        matchedSessionIds: [],
        failures: [],
        repeatedReadFiles: [],
        sessions: [],
        analysis: {
          updatedAt: "2026-04-22T12:05:00.000Z",
          summary: "Start from kanban.rs and the events route before broader MCP scanning.",
          topFiles: ["crates/routa-server/src/api/kanban.rs"],
          topSessions: [{
            sessionId: "019daf46-1a5b-7001-8a17-df4a7053ace0",
            provider: "codex",
            reason: "Covers the flow-event write path directly.",
          }],
          reusablePrompts: ["Check the persisted flow event path before touching dashboard code."],
          recommendedContextSearchSpec: {
            featureCandidates: ["kanban-workflow"],
            relatedFiles: ["crates/routa-server/src/api/kanban.rs"],
          },
        },
      },
    });

    const prompt = buildTaskPrompt(task);

    expect(prompt).toContain("## Saved History Memory");
    expect(prompt).toContain("Start from kanban.rs and the events route before broader MCP scanning.");
    expect(prompt).toContain("Top files: crates/routa-server/src/api/kanban.rs");
    expect(prompt).toContain("019daf46-1a5b-7001-8a17-df4a7053ace0 (codex): Covers the flow-event write path directly.");
    expect(prompt).toContain("Recommended context search spec:");
  });

  it("adds previous-lane handoff guidance for review sessions", () => {
    const task = createTask({
      id: "task-4",
      title: "Review running app",
      objective: "Verify the feature in review",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "review",
    });
    task.laneSessions = [
      {
        sessionId: "session-dev-1",
        columnId: "dev",
        columnName: "Dev",
        provider: "opencode",
        role: "DEVELOPER",
        status: "completed",
        startedAt: "2026-03-17T00:00:00.000Z",
      },
    ];

    const prompt = buildTaskPrompt(task, [
      { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
      { id: "dev", name: "Dev", position: 1, stage: "dev" },
      { id: "review", name: "Review", position: 2, stage: "review" },
      { id: "done", name: "Done", position: 3, stage: "done" },
    ], {
      currentSessionId: "session-review-1",
    });

    expect(prompt).toContain("## Lane Handoff Context");
    expect(prompt).toContain("request_previous_lane_handoff");
    expect(prompt).toContain("Previous lane session");
    expect(prompt).toContain("Dev");
  });

  it("shows unresolved handoffs when a card returns to the target lane with a new session", () => {
    const task = createTask({
      id: "task-4b",
      title: "Rework review feedback",
      objective: "Address review feedback in dev",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "dev",
    });
    task.laneSessions = [
      {
        sessionId: "session-dev-1",
        columnId: "dev",
        columnName: "Dev",
        provider: "opencode",
        role: "DEVELOPER",
        status: "completed",
        startedAt: "2026-03-17T00:00:00.000Z",
      },
      {
        sessionId: "session-review-1",
        columnId: "review",
        columnName: "Review",
        provider: "codex",
        role: "GATE",
        status: "completed",
        startedAt: "2026-03-17T01:00:00.000Z",
      },
      {
        sessionId: "session-dev-2",
        columnId: "dev",
        columnName: "Dev",
        provider: "opencode",
        role: "DEVELOPER",
        status: "running",
        startedAt: "2026-03-17T02:00:00.000Z",
      },
    ];
    task.laneHandoffs = [
      {
        id: "handoff-1",
        fromSessionId: "session-review-1",
        toSessionId: "session-dev-1",
        fromColumnId: "review",
        toColumnId: "dev",
        requestType: "rerun_command",
        request: "Please rerun Storybook and attach the failure log.",
        status: "delivered",
        requestedAt: "2026-03-17T01:30:00.000Z",
      },
    ];

    const prompt = buildTaskPrompt(task, [
      { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
      { id: "dev", name: "Dev", position: 1, stage: "dev" },
      { id: "review", name: "Review", position: 2, stage: "review" },
      { id: "done", name: "Done", position: 3, stage: "done" },
    ], {
      currentSessionId: "session-dev-2",
    });

    expect(prompt).toContain("## Lane Handoff Context");
    expect(prompt).toContain("Pending handoff 1: Rerun command");
    expect(prompt).toContain("Please rerun Storybook and attach the failure log.");
    expect(prompt).toContain("submit_lane_handoff");
  });

  it("shows unresolved handoffs for the current lane even when currentSessionId is unavailable", () => {
    const task = createTask({
      id: "task-4c",
      title: "Recover dev verification context",
      objective: "Continue dev with review feedback context",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "dev",
    });
    task.laneSessions = [
      {
        sessionId: "session-dev-1",
        columnId: "dev",
        columnName: "Dev",
        provider: "opencode",
        role: "DEVELOPER",
        status: "completed",
        startedAt: "2026-03-17T00:00:00.000Z",
      },
      {
        sessionId: "session-review-1",
        columnId: "review",
        columnName: "Review",
        provider: "codex",
        role: "GATE",
        status: "completed",
        startedAt: "2026-03-17T01:00:00.000Z",
      },
    ];
    task.laneHandoffs = [
      {
        id: "handoff-2",
        fromSessionId: "session-review-1",
        toSessionId: "session-dev-1",
        fromColumnId: "review",
        toColumnId: "dev",
        requestType: "runtime_context",
        request: "Use the same seeded fixture and confirm the visual diff.",
        status: "delivered",
        requestedAt: "2026-03-17T01:30:00.000Z",
      },
    ];

    const prompt = buildTaskPrompt(task, [
      { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
      { id: "dev", name: "Dev", position: 1, stage: "dev" },
      { id: "review", name: "Review", position: 2, stage: "review" },
      { id: "done", name: "Done", position: 3, stage: "done" },
    ]);

    expect(prompt).toContain("## Lane Handoff Context");
    expect(prompt).toContain("Pending handoff 1: Runtime context");
    expect(prompt).toContain("Use the same seeded fixture and confirm the visual diff.");
  });

  it("routes review happy-path guidance to done even if blocked is positioned before it", () => {
    const task = createTask({
      id: "task-review-1",
      title: "Approve review result",
      objective: "Verify the card advances to done on approval",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "review",
    });

    const prompt = buildTaskPrompt(task, [
      { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
      { id: "todo", name: "Todo", position: 1, stage: "todo" },
      { id: "dev", name: "Dev", position: 2, stage: "dev" },
      { id: "review", name: "Review", position: 3, stage: "review" },
      { id: "blocked", name: "Blocked", position: 4, stage: "blocked" },
      { id: "done", name: "Done", position: 5, stage: "done" },
    ]);

    expect(prompt).toContain("targetColumnId: \"done\"");
    expect(prompt).toContain("**Next Column ID:** done");
    expect(prompt).toContain("Moving this card to Done");
    expect(prompt).not.toContain("targetColumnId: \"blocked\"");
  });

  it("includes previous run context for multi-step sessions in the same lane", () => {
    const task = createTask({
      id: "task-5",
      title: "Continue todo planning",
      objective: "Run the second todo step with context from the first one",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "todo",
    });
    task.laneSessions = [
      {
        sessionId: "session-todo-1",
        columnId: "todo",
        columnName: "Todo",
        stepIndex: 0,
        stepName: "Todo Triage",
        provider: "claude",
        role: "CRAFTER",
        status: "completed",
        startedAt: "2026-03-17T00:00:00.000Z",
        completedAt: "2026-03-17T00:05:00.000Z",
      },
    ];

    const prompt = buildTaskPrompt(task, [
      { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
      { id: "todo", name: "Todo", position: 1, stage: "todo" },
      { id: "dev", name: "Dev", position: 2, stage: "dev" },
    ], {
      currentSessionId: "session-todo-2",
    });

    expect(prompt).toContain("## Current Lane History");
    expect(prompt).toContain("Previous run in this lane");
    expect(prompt).toContain("Todo Triage");
  });

  it("does not instruct an earlier lane step to move the card before later steps run", () => {
    const task = createTask({
      id: "task-6",
      title: "Run todo pipeline",
      objective: "Complete the first todo step and let the workflow continue in-lane",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "todo",
      assignedProvider: "codex",
      assignedRole: "CRAFTER",
      assignedSpecialistId: "kanban-todo-orchestrator",
      assignedSpecialistName: "Todo Orchestrator",
    });

    const prompt = buildTaskPrompt(task, [
      { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
      {
        id: "todo",
        name: "Todo",
        position: 1,
        stage: "todo",
        automation: {
          enabled: true,
          steps: [
            {
              id: "step-1",
              providerId: "codex",
              role: "CRAFTER",
              specialistId: "kanban-todo-orchestrator",
              specialistName: "Todo Orchestrator",
            },
            {
              id: "step-2",
              role: "GATE",
              specialistId: "gate",
              specialistName: "Verifier",
            },
          ],
        },
      },
      { id: "dev", name: "Dev", position: 2, stage: "dev" },
    ], {
      currentSessionId: "session-todo-1",
    });

    expect(prompt).toContain("Do not call `move_card` to leave todo yet");
    expect(prompt).toContain("Verifier");
    expect(prompt).not.toContain('targetColumnId: "dev"');
  });

  it("does not tell the last review step that it is still pending when triggerSessionId points at the previous step", () => {
    const prompt = buildTaskPrompt(buildReviewTaskAfterQaFrontend("guard"), twoStepReviewColumns, {
      currentSessionId: "session-review-guard",
      currentStepIndex: 1,
    });

    expect(prompt).not.toMatch(/still has .* pending/);
    expect(prompt).not.toContain("Do not call `move_card` to leave review yet");
    expect(prompt).toContain('targetColumnId: "done"');
  });

  it("still tells the first review step that Review Guard is pending", () => {
    const prompt = buildTaskPrompt(buildReviewTaskAfterQaFrontend("qa"), twoStepReviewColumns, {
      currentSessionId: "session-qa-frontend-2",
      currentStepIndex: 0,
    });

    expect(prompt).toContain("This lane still has Review Guard pending");
    expect(prompt).not.toContain('targetColumnId: "done"');
  });
});

describe("triggerAssignedTaskAgent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    sendMessageMock.mockReset();
    waitForCompletionMock.mockReset();
  });

  it("emits AGENT_FAILED when session/prompt returns a JSON-RPC error payload", async () => {
    // Only session creation goes over fetch; the prompt itself is dispatched
    // through the (mocked) dispatchSessionPrompt since 97a1c50d.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: "new",
        result: { sessionId: "sess-1" },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);
    dispatchSessionPromptMock.mockRejectedValueOnce(
      new Error("Permission denied: HTTP error: 403 Forbidden"),
    );

    const eventBus = { emit: vi.fn() };
    const task = createTask({
      id: "task-json-error",
      title: "Run failing provider",
      objective: "Trigger a provider failure",
      workspaceId: "default",
      columnId: "dev",
      assignedProvider: "auggie",
      assignedRole: "DEVELOPER",
    });

    const result = await triggerAssignedTaskAgent({
      origin: "http://127.0.0.1:3000",
      workspaceId: "default",
      cwd: "/tmp/project",
      task,
      eventBus: eventBus as unknown as EventBus,
    });

    expect(result).toMatchObject({
      sessionId: "sess-1",
      transport: "acp",
      displayTarget: "auggie",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      type: AgentEventType.AGENT_FAILED,
      agentId: "sess-1",
    }));
  });

});

describe("resolveKanbanAutomationProvider", () => {
  afterEach(() => {
    vi.mocked(isClaudeCodeSdkConfigured).mockReset();
  });

  it("falls back to the Claude SDK when automation targets claude and the SDK is configured", () => {
    vi.mocked(isClaudeCodeSdkConfigured).mockReturnValue(true);

    expect(resolveKanbanAutomationProvider("claude")).toBe("claude-code-sdk");
  });

  it("preserves the configured provider when no Claude SDK fallback is needed", () => {
    vi.mocked(isClaudeCodeSdkConfigured).mockReturnValue(false);

    expect(resolveKanbanAutomationProvider("claude")).toBe("claude");
    expect(resolveKanbanAutomationProvider("codex")).toBe("codex");
    expect(resolveKanbanAutomationProvider(undefined)).toBe("opencode");
  });
});

describe("triggerAssignedTaskAgent ACP prompt lifecycle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    sendMessageMock.mockReset();
    waitForCompletionMock.mockReset();
    dispatchSessionPromptMock.mockReset();
  });

  it("does not emit AGENT_COMPLETED when ACP prompt submission succeeds", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: "new",
        result: { sessionId: "sess-1" },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);
    dispatchSessionPromptMock.mockResolvedValue(undefined);

    const eventBus = { emit: vi.fn() };
    const task = {
      ...createTask({
      id: "task-acp-success",
      title: "Run ACP task",
      objective: "Let ACP lifecycle report completion",
      workspaceId: "default",
      columnId: "dev",
      assignedProvider: "codex",
      assignedRole: "DEVELOPER",
      triggerSessionId: "session-trigger",
      }),
      sessionIds: ["session-history"],
      laneSessions: [{
        sessionId: "session-lane",
        status: "completed" as const,
        startedAt: "2025-01-01T00:00:00.000Z",
      }],
    };

    const result = await triggerAssignedTaskAgent({
      origin: "http://127.0.0.1:3000",
      workspaceId: "default",
      cwd: "/tmp/project",
      task,
      eventBus: eventBus as unknown as EventBus,
    });

    expect(result).toMatchObject({
      sessionId: "sess-1",
      transport: "acp",
      displayTarget: "codex",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/api/acp",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("\"name\":\"Run ACP task · DEVELOPER\""),
      }),
    );
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.params.taskAdaptiveHarness).toEqual({
      taskId: "task-acp-success",
      taskLabel: "Run ACP task",
      query: "Run ACP task",
      historySessionIds: ["session-trigger", "session-history", "session-lane"],
      taskType: "implementation",
      role: "DEVELOPER",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dispatchSessionPromptMock).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "sess-1",
      workspaceId: "default",
      cwd: "/tmp/project",
    }));
    expect(eventBus.emit).not.toHaveBeenCalledWith(expect.objectContaining({
      type: AgentEventType.AGENT_COMPLETED,
      agentId: "sess-1",
    }));
  });

  it("builds the launching step's prompt from the step being started, not the previous triggerSessionId", async () => {
    for (const [assignedStep, stepIndex, sessionId] of [["guard", 1, "sess-review-guard"], ["qa", 0, "sess-qa-frontend"]] as const) {
      dispatchSessionPromptMock.mockReset();
      dispatchSessionPromptMock.mockResolvedValue(undefined);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: "new",
        result: { sessionId },
      }), { status: 200, headers: { "Content-Type": "application/json" } })));

      await triggerAssignedTaskAgent({
        origin: "http://127.0.0.1:3000",
        workspaceId: "default",
        cwd: "/tmp/project",
        task: buildReviewTaskAfterQaFrontend(assignedStep),
        step: twoStepReviewColumns[1]!.automation!.steps![stepIndex],
        stepIndex,
        boardColumns: twoStepReviewColumns,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      const promptText = String(dispatchSessionPromptMock.mock.calls[0]?.[0]?.prompt?.[0]?.text ?? "");
      expect(promptText).not.toBe("");
      if (assignedStep === "guard") {
        expect(promptText).not.toMatch(/still has .* pending/);
        expect(promptText).toContain('targetColumnId: "done"');
      } else {
        expect(promptText).toContain("This lane still has Review Guard pending");
      }
    }
  });

  describe("session/new model and reasoning effort", () => {
    const launch = async (options: {
      assignedModel?: string;
      assignedReasoningEffort?: string;
      step?: KanbanAutomationStep;
    }) => {
      const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: "new",
        result: { sessionId: "sess-model" },
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
      vi.stubGlobal("fetch", fetchMock);
      dispatchSessionPromptMock.mockResolvedValue(undefined);
      // Run the step through the same resolver the orchestrator uses so a
      // field dropped on the way would fail here.
      const resolvedStep = resolveKanbanAutomationStep(options.step, undefined, { autoProviderId: "dsh" });
      const result = await triggerAssignedTaskAgent({
        origin: "http://127.0.0.1:3000",
        workspaceId: "default",
        cwd: "/tmp/project",
        task: createTask({
          id: "task-model",
          title: "Pick a model",
          objective: "Pass model and effort to session/new",
          workspaceId: "default",
          columnId: "dev",
          assignedProvider: "dsh",
          assignedRole: "CRAFTER",
          assignedModel: options.assignedModel,
          assignedReasoningEffort: options.assignedReasoningEffort,
        }),
        step: resolvedStep,
        stepModel: resolvedStep?.model,
        stepReasoningEffort: resolvedStep?.reasoningEffort,
      });
      const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
      return { params: requestBody.params as Record<string, unknown>, result };
    };

    it("prefers the card override over the column step setting", async () => {
      const { params, result } = await launch({
        assignedModel: "gpt-6.1-sol",
        assignedReasoningEffort: "high",
        step: { id: "dev-1", model: "claude-opus-5-5", reasoningEffort: "low" },
      });
      expect(params).toMatchObject({ model: "gpt-6.1-sol", reasoningEffort: "high" });
      expect(result).toMatchObject({ model: "gpt-6.1-sol", reasoningEffort: "high" });
    });

    it("uses the column step setting when the card has no override", async () => {
      const { params } = await launch({
        step: { id: "dev-1", model: "claude-opus-5-5", reasoningEffort: "medium" },
      });
      expect(params).toMatchObject({ model: "claude-opus-5-5", reasoningEffort: "medium" });
    });

    it("leaves both keys out of params when neither card nor step sets them", async () => {
      const { params, result } = await launch({
        assignedModel: "   ",
        step: { id: "dev-1", model: "", reasoningEffort: undefined },
      });
      expect(params).not.toHaveProperty("model");
      expect(params).not.toHaveProperty("reasoningEffort");
      expect(result.model).toBeUndefined();
      expect(result.reasoningEffort).toBeUndefined();
    });

    it("decides model and effort independently", async () => {
      const { params } = await launch({
        assignedReasoningEffort: "xhigh",
        step: { id: "dev-1", model: "claude-opus-5-5" },
      });
      expect(params).toMatchObject({ model: "claude-opus-5-5", reasoningEffort: "xhigh" });
    });
  });

  it("resolveSessionModelSelection trims values and drops blanks", () => {
    expect(resolveSessionModelSelection({
      task: { assignedModel: " m1 ", assignedReasoningEffort: "" },
      stepModel: "m2",
      stepReasoningEffort: " low ",
    })).toEqual({ model: "m1", reasoningEffort: "low" });
    expect(resolveSessionModelSelection({ task: {} })).toEqual({});
  });

  it("sets the kanban planning MCP profile when the lane needs artifact evidence", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: "new",
        result: { sessionId: "sess-evidence" },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);
    dispatchSessionPromptMock.mockResolvedValue(undefined);

    const task = createTask({
      id: "task-evidence-profile",
      title: "Review release evidence",
      objective: "The next transition requires stored evidence",
      workspaceId: "default",
      boardId: "board-evidence",
      columnId: "review",
      assignedProvider: "codex",
      assignedRole: "GATE",
    });

    await triggerAssignedTaskAgent({
      origin: "http://127.0.0.1:3000",
      workspaceId: "default",
      cwd: "/tmp/project",
      task,
      boardColumns: [
        { id: "review", name: "Review", stage: "review", position: 0 },
        {
          id: "done",
          name: "Done",
          stage: "done",
          position: 1,
          automation: {
            enabled: true,
            requiredArtifacts: ["test_results"],
          },
        },
      ],
    });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.params).toMatchObject({
      toolMode: "full",
      mcpProfile: "kanban-planning",
    });
  });

  it("does not emit AGENT_FAILED when ACP prompt times out waiting for the HTTP response", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: "new",
        result: { sessionId: "sess-timeout" },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);
    dispatchSessionPromptMock.mockRejectedValue(new Error("Timeout waiting for session/prompt (id=3)"));

    const eventBus = { emit: vi.fn() };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const task = createTask({
      id: "task-acp-timeout",
      title: "Run ACP task with delayed prompt response",
      objective: "Keep waiting for lifecycle events",
      workspaceId: "default",
      columnId: "dev",
      assignedProvider: "codex",
      assignedRole: "DEVELOPER",
    });

    const result = await triggerAssignedTaskAgent({
      origin: "http://127.0.0.1:3000",
      workspaceId: "default",
      cwd: "/tmp/project",
      task,
      eventBus: eventBus as unknown as EventBus,
    });

    expect(result).toMatchObject({
      sessionId: "sess-timeout",
      transport: "acp",
      displayTarget: "codex",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(warnSpy).toHaveBeenCalledWith(
      "[kanban] ACP task session prompt is still running after HTTP timeout; waiting for lifecycle events:",
      expect.any(Error),
    );
    expect(errorSpy).not.toHaveBeenCalledWith(
      "[kanban] Failed to auto-prompt ACP task session:",
      expect.anything(),
    );
    expect(eventBus.emit).not.toHaveBeenCalledWith(expect.objectContaining({
      type: AgentEventType.AGENT_FAILED,
      agentId: "sess-timeout",
    }));
  });

  it("emits AGENT_FAILED when in-process prompt dispatch fails immediately", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: "new",
        result: { sessionId: "sess-error" },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);
    dispatchSessionPromptMock.mockRejectedValue(new Error("fetch failed"));

    const eventBus = { emit: vi.fn() };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const task = createTask({
      id: "task-acp-error",
      title: "Run ACP task with dispatch failure",
      objective: "Surface prompt dispatch failures",
      workspaceId: "default",
      columnId: "dev",
      assignedProvider: "codex",
      assignedRole: "DEVELOPER",
    });

    const result = await triggerAssignedTaskAgent({
      origin: "http://127.0.0.1:3000",
      workspaceId: "default",
      cwd: "/tmp/project",
      task,
      eventBus: eventBus as unknown as EventBus,
    });

    expect(result).toMatchObject({
      sessionId: "sess-error",
      transport: "acp",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errorSpy).toHaveBeenCalledWith(
      "[kanban] Failed to auto-prompt ACP task session:",
      expect.any(Error),
    );
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      type: AgentEventType.AGENT_FAILED,
      agentId: "sess-error",
      data: expect.objectContaining({
        sessionId: "sess-error",
        error: "fetch failed",
      }),
    }));
  });

  it("downgrades legacy A2A transport steps to ACP session prompts", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: "new",
        result: { sessionId: "sess-downgraded" },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);
    dispatchSessionPromptMock.mockResolvedValue(undefined);

    const task = createTask({
      id: "task-a2a-legacy",
      title: "Run review",
      objective: "Use the configured lane automation",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "review",
      assignedRole: "GATE",
    });

    const result = await triggerAssignedTaskAgent({
      origin: "http://127.0.0.1:3000",
      workspaceId: "default",
      cwd: "/tmp/project",
      task,
      step: {
        id: "remote-review",
        transport: "a2a",
        agentCardUrl: "https://agents.example.com/reviewer/agent-card.json",
        skillId: "review",
        role: "GATE",
      },
    });

    expect(result).toMatchObject({
      sessionId: "sess-downgraded",
      transport: "acp",
    });
    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(waitForCompletionMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(dispatchSessionPromptMock).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "sess-downgraded",
    }));
  });
});
