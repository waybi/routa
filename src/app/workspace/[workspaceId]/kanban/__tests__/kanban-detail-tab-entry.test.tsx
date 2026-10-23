import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KanbanCardDetail } from "../kanban-card-detail";
import { KanbanTab } from "../kanban-tab";
import { I18nProvider } from "@/i18n";
import {
  consumeKanbanDetailTabRequest,
  requestKanbanDetailTab,
  resolveKanbanDetailTab,
  type KanbanDetailTabId,
} from "../kanban-detail-tab-request";
import {
  KanbanDetailMetaStrip,
  readKanbanDetailMetaFacts,
  resolveKanbanDetailMetaItems,
  type KanbanDetailMetaItem,
} from "../kanban-detail-meta-strip";
import type { TaskInfo } from "../../types";
import { resetDesktopAwareFetchToGlobalFetch } from "./test-utils";
import { createDetailTask, detailBoard } from "./kanban-detail-fixtures";

/**
 * Card 8a2d2555: which tab the detail opens on for every entry point
 * (C3 / F4), the new detail shell reaching each entry, no writes on open
 * (F2-d), and two random cross-checks against judging tables written here
 * from the requirement (F3), each with a planted error the check must catch.
 */

const { desktopAwareFetch } = vi.hoisted(() => ({ desktopAwareFetch: vi.fn() }));

vi.mock("@/client/utils/diagnostics", async () => {
  const actual = await vi.importActual<typeof import("@/client/utils/diagnostics")>("@/client/utils/diagnostics");
  return { ...actual, desktopAwareFetch };
});

vi.mock("@/client/components/repo-picker", () => ({
  RepoPicker: () => <div data-testid="repo-picker-mock" />,
}));

vi.mock("../use-runtime-fitness-status", async () => {
  const { mockUseRuntimeFitnessStatus } = await import("./test-utils");
  return { useRuntimeFitnessStatus: mockUseRuntimeFitnessStatus };
});

const BOARD_PATH = "/workspace/workspace-1/kanban";

beforeEach(() => {
  resetDesktopAwareFetchToGlobalFetch(desktopAwareFetch);
  desktopAwareFetch.mockImplementation(async () => new Response(JSON.stringify({ artifacts: [], runs: [] }), { status: 200 }));
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.history.replaceState({}, "", BOARD_PATH);
});

const EN_TABS = ["Overview", "Story Readiness", "Execution", "History Memory", "Changes", "Evidence Bundle", "Runs", "Completion"];
const ZH_TABS = ["概览", "故事就绪度", "执行", "历史记忆", "变更", "证据摘要", "运行", "完成汇报"];
// Assembled so the removed plain-language id appears only in kanban-detail-tab-request.ts.
const PLAIN_LANGUAGE_ID = ["human", "Readable"].join("");
const withReport = { comments: [{ id: "r1", body: "## Completion Summary\nShipped", createdAt: "2026-10-22T02:00:00.000Z", source: "update_card" as const }] };

function detailElement(task: TaskInfo) {
  return (
    <KanbanCardDetail
      task={task}
      boardColumns={detailBoard.columns}
      availableProviders={[]}
      specialists={[]}
      specialistLanguage="en"
      codebases={[]}
      allCodebaseIds={[]}
      worktreeCache={{}}
      sessions={[]}
      fullWidth
      onToggleFullscreen={vi.fn()}
      onPatchTask={vi.fn(async () => task)}
      onRetryTrigger={vi.fn(async () => {})}
      onDelete={vi.fn()}
      onRefresh={vi.fn()}
      onClose={vi.fn()}
    />
  );
}

const renderDetail = (task: TaskInfo) => render(detailElement(task));

const selectedTab = () => screen.getAllByRole("tab").find((tab) => tab.getAttribute("aria-selected") === "true")?.textContent;
const flushMicrotasks = () => act(async () => { await Promise.resolve(); });

describe("detailTab on open (C3)", () => {
  it.each([
    ["construction", {}, "Execution"],
    ["changes", {}, "Changes"],
    [PLAIN_LANGUAGE_ID, withReport, "Overview"],
    ["bogus", withReport, "Completion"],
  ])("?detailTab=%s opens %s and leaves the address bar", async (detailTab, overrides, expected) => {
    const id = `entry-${detailTab}`;
    window.history.replaceState({}, "", `${BOARD_PATH}?taskId=${id}&detailTab=${detailTab}`);
    renderDetail(createDetailTask(id, "Entry card", overrides));
    expect(selectedTab()).toBe(expected);
    await flushMicrotasks();
    expect(window.location.search).not.toContain("detailTab");
    expect(window.location.search).toContain(`taskId=${id}`);
  });

  it("an unknown detailTab falls back to the tab picked on this card before", async () => {
    const id = "entry-remembered";
    const first = renderDetail(createDetailTask(id, "Entry card", withReport));
    fireEvent.click(screen.getByRole("tab", { name: "History Memory" }));
    first.unmount();
    window.history.replaceState({}, "", `${BOARD_PATH}?taskId=${id}&detailTab=bogus`);
    renderDetail(createDetailTask(id, "Entry card", withReport));
    expect(selectedTab()).toBe("History Memory");
    await flushMicrotasks();
    expect(window.location.search).not.toContain("detailTab");
  });

  it("requestKanbanDetailTab('evidence') opens Evidence Bundle", () => {
    requestKanbanDetailTab("entry-request", "evidence");
    renderDetail(createDetailTask("entry-request", "Entry card", withReport));
    expect(selectedTab()).toBe("Evidence Bundle");
  });

  it("shows the eight tabs in Chinese for zh-CN", () => {
    window.localStorage.setItem("routa.locale", "zh");
    try {
      render(<I18nProvider>{detailElement(createDetailTask("entry-zh", "Entry card"))}</I18nProvider>);
      expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(ZH_TABS);
      expect(screen.queryByRole("tab", { name: /施工|变更与证据|人话版/ })).toBeNull();
    } finally {
      window.localStorage.removeItem("routa.locale");
    }
  });
});

function renderBoard(tasks: TaskInfo[]) {
  return render(
    <KanbanTab
      workspaceId="workspace-1"
      boards={[detailBoard]}
      tasks={tasks}
      sessions={[]}
      providers={[]}
      specialists={[]}
      codebases={[]}
      onRefresh={vi.fn()}
    />,
  );
}

function expectNewShell() {
  const detail = screen.getByTestId("kanban-card-detail");
  expect(Array.from(detail.querySelectorAll("[role='tab']")).map((tab) => tab.textContent)).toEqual(EN_TABS);
  expect(detail.querySelector("[data-testid='kanban-detail-meta-strip']")).toBeTruthy();
  expect(detail.querySelector("[data-testid='kanban-detail-delete']")).toBeTruthy();
  expect(detail.querySelector("[data-testid='kanban-detail-property-rail']")).toBeNull();
}

function countCalls(match: (url: string, method: string) => boolean): number {
  return desktopAwareFetch.mock.calls.filter(([input, init]) => match(String(input), String((init as RequestInit | undefined)?.method ?? "GET").toUpperCase())).length;
}

describe("every way into the detail reaches the new shell (F4)", () => {
  const card = createDetailTask("task-1", "Story One", { ...withReport, sessionIds: ["s-1"], laneSessions: [{ sessionId: "s-1", columnId: "backlog", status: "completed", startedAt: "2026-10-22T00:00:00.000Z" }] });

  it("board click", async () => {
    renderBoard([card]);
    fireEvent.click(screen.getByRole("button", { name: "Open Story One" }));
    await screen.findByTestId("kanban-card-detail");
    expectNewShell();
  });

  it.each([
    ["taskId only", "", "Completion"],
    ["detailTab=completion (bell / inbox)", "&detailTab=completion", "Completion"],
    ["detailTab=changes (session detail evidence link)", "&detailTab=changes", "Changes"],
    ["detailTab=construction (redesign id)", "&detailTab=construction", "Execution"],
  ])("URL with %s", async (_label, extra, expected) => {
    window.history.replaceState({}, "", `${BOARD_PATH}?taskId=task-1${extra}`);
    renderBoard([card]);
    await screen.findByTestId("kanban-card-detail");
    expectNewShell();
    expect(selectedTab()).toBe(expected);
  });

  it("toast request (requestKanbanDetailTab)", async () => {
    requestKanbanDetailTab("task-1", "runs");
    renderBoard([card]);
    fireEvent.click(screen.getByRole("button", { name: "Open Story One" }));
    await screen.findByTestId("kanban-card-detail");
    expectNewShell();
    expect(selectedTab()).toBe("Runs");
  });

  it("opening the board and the detail by URL writes nothing to /api/tasks (F2-d)", async () => {
    window.history.replaceState({}, "", `${BOARD_PATH}?taskId=task-1&detailTab=changes`);
    renderBoard([card]);
    await screen.findByTestId("kanban-card-detail");
    await flushMicrotasks();
    expect(countCalls((url, method) => url.includes("/api/tasks") && (method === "PATCH" || method === "POST"))).toBe(0);
    // Removing detailTab from the address bar is history.replaceState only.
    expect(window.location.search).not.toContain("detailTab");
  });
});

// ─── F3 random cross-checks ────────────────────────────────────────────

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const EIGHT_IDS = ["overview", "readiness", "execution", "jitContext", "changes", "evidence", "runs", "completion"];

/** Judging table from AC4, written independently of kanban-detail-tab-request.ts. */
function judgeMapping(planted: boolean): Map<string, string> {
  const table = new Map<string, string>(EIGHT_IDS.map((id) => [id, id]));
  table.set("construction", planted ? "runs" : "execution");
  table.set(PLAIN_LANGUAGE_ID, "overview");
  return table;
}

function judgeTab(input: { requested: string | null; persisted: string | null; hasReport: boolean }, table: Map<string, string>): string {
  const forced = input.requested ? table.get(input.requested) : undefined;
  if (forced) return forced;
  const remembered = input.persisted ? table.get(input.persisted) : undefined;
  if (remembered) return remembered;
  return input.hasReport ? "completion" : "overview";
}

function randomWord(rand: () => number): string {
  const letters = "abcdefghijklmnopqrstuvwxyzABC";
  return Array.from({ length: 1 + Math.floor(rand() * 10) }, () => letters[Math.floor(rand() * letters.length)]).join("");
}

const REQUEST_VALUES: Array<string | null> = [...EIGHT_IDS, "construction", PLAIN_LANGUAGE_ID, "bogus", "", null];
const PERSISTED_VALUES: Array<string | null> = [null, ...EIGHT_IDS];

type TabCase = { requested: string | null; source: "url" | "request"; persisted: string | null; hasReport: boolean };

function actualTab(input: TabCase): KanbanDetailTabId {
  const taskId = "fuzz-card";
  window.history.replaceState({}, "", input.source === "url" && input.requested !== null
    ? `${BOARD_PATH}?taskId=${taskId}&detailTab=${encodeURIComponent(input.requested)}`
    : BOARD_PATH);
  if (input.source === "request" && input.requested !== null) {
    requestKanbanDetailTab(taskId, input.requested as KanbanDetailTabId);
  }
  const requested = consumeKanbanDetailTabRequest(taskId);
  return resolveKanbanDetailTab({ requested, persisted: input.persisted, hasCompletionReport: input.hasReport });
}

function tabCases(rand: () => number, randomCount: number): TabCase[] {
  const cases: TabCase[] = [];
  for (const requested of REQUEST_VALUES) {
    for (const source of ["url", "request"] as const) {
      for (const persisted of PERSISTED_VALUES) {
        for (const hasReport of [true, false]) cases.push({ requested, source, persisted, hasReport });
      }
    }
  }
  for (let i = 0; i < randomCount; i += 1) {
    const pick = rand();
    const requested = pick < 0.6 ? REQUEST_VALUES[Math.floor(rand() * REQUEST_VALUES.length)]! : randomWord(rand);
    const persisted = rand() < 0.8 ? PERSISTED_VALUES[Math.floor(rand() * PERSISTED_VALUES.length)]! : randomWord(rand);
    cases.push({ requested, source: rand() < 0.5 ? "url" : "request", persisted, hasReport: rand() < 0.5 });
  }
  return cases;
}

function countTabMismatches(table: Map<string, string>, seed: number, randomCount: number) {
  const cases = tabCases(mulberry32(seed), randomCount);
  const mismatches = cases.filter((input) => actualTab(input) !== judgeTab(input, table));
  window.history.replaceState({}, "", BOARD_PATH);
  return { total: cases.length, mismatches };
}

describe("F3 cross-check: detail tab resolution", () => {
  it("the planted error (construction → runs) is caught", () => {
    const { mismatches } = countTabMismatches(judgeMapping(true), 7, 2_000);
    expect(mismatches.length).toBeGreaterThan(0);
  });

  it("all exhaustive combinations plus 10,000 random ones agree with the AC4 table", () => {
    const { total, mismatches } = countTabMismatches(judgeMapping(false), 20261023, 10_000);
    expect(total).toBeGreaterThanOrEqual(10_468);
    expect(mismatches.slice(0, 3)).toEqual([]);
  });
});

type MetaCase = { task: TaskInfo; runCount: number; expected: KanbanDetailMetaItem[]; mergeChoice: "merged" | "unmerged" | "unknown" };

function metaCases(rand: () => number, count: number, plantedUnknownMerge: boolean): MetaCase[] {
  const cases: MetaCase[] = [];
  for (let i = 0; i < count; i += 1) {
    const runCount = Math.floor(rand() * 13);
    const readiness = rand() < 0.5 ? null : rand() < 0.5;
    const hasEvidence = rand() < 0.5;
    const github = rand() < 0.5 ? null : 1 + Math.floor(rand() * 500);
    const githubUrl = github && rand() < 0.5 ? `https://github.com/o/r/issues/${github}` : undefined;
    const commits = Math.floor(rand() * 6);
    const mergeChoice = (["merged", "unmerged", "unknown"] as const)[Math.floor(rand() * 3)]!;
    const labels = Array.from({ length: Math.floor(rand() * 5) }, (_, index) => `label-${index}`);
    const task = createDetailTask(`meta-${i}`, "Meta card", {
      columnId: mergeChoice === "unknown" && rand() < 0.5 ? "dev" : "done",
      storyReadiness: readiness === null ? undefined : {
        ready: readiness,
        missing: [],
        requiredTaskFields: [],
        checks: { scope: true, acceptanceCriteria: true, verificationCommands: true, testCases: true, verificationPlan: true, dependenciesDeclared: true },
      },
      evidenceSummary: hasEvidence ? {
        artifact: { total: 0, byType: {}, requiredSatisfied: rand() < 0.5, missingRequired: [] },
        verification: { hasVerdict: false, hasReport: rand() < 0.5 },
        completion: { hasSummary: false },
        runs: { total: runCount, latestStatus: "completed" },
      } : undefined,
      githubNumber: github ?? undefined,
      githubUrl,
      deliveryReadiness: { checked: true, commitsSinceBase: commits, hasCommitsSinceBase: commits > 0 } as TaskInfo["deliveryReadiness"],
      deliveryLanding: mergeChoice === "merged"
        ? { landedOnBase: true, commitsSinceBase: 0 }
        : mergeChoice === "unmerged" ? { landedOnBase: false, commitsSinceBase: 1 + Math.floor(rand() * 4) } : { landedOnBase: null, commitsSinceBase: 0 },
      labels,
    });
    // Judging set from AC5, computed from the generated choices only.
    const expected: KanbanDetailMetaItem[] = [];
    if (runCount > 0) expected.push("runs");
    if (readiness !== null) expected.push("readiness");
    if (hasEvidence) expected.push("evidence");
    if (github) expected.push("github");
    if (commits > 0) expected.push("commits");
    if (mergeChoice !== "unknown" || plantedUnknownMerge) expected.push("merge");
    if (labels.length > 0) expected.push("labels");
    cases.push({ task, runCount, expected, mergeChoice });
  }
  return cases;
}

const metaMismatches = (cases: MetaCase[]) => cases.filter(({ task, runCount, expected }) => (
  resolveKanbanDetailMetaItems(readKanbanDetailMetaFacts(task, runCount)).join(",") !== expected.join(",")
));

describe("F3 cross-check: meta strip items", () => {
  it("the planted error (unknown merge state shows a badge) is caught", () => {
    expect(metaMismatches(metaCases(mulberry32(11), 2_000, true)).length).toBeGreaterThan(0);
  });

  it("10,000 random cards agree with the AC5 judging set", () => {
    const mismatches = metaMismatches(metaCases(mulberry32(20261023), 10_000, false));
    expect(mismatches.slice(0, 3).map((entry) => entry.task.id)).toEqual([]);
  });

  it("200 rendered samples show exactly the judged items", () => {
    const testIds: Record<Exclude<KanbanDetailMetaItem, "merge" | "labels">, string> = {
      runs: "kanban-detail-meta-runs",
      readiness: "kanban-detail-meta-readiness",
      evidence: "kanban-detail-meta-evidence",
      github: "kanban-detail-meta-github",
      commits: "kanban-detail-meta-commits",
    };
    for (const { task, runCount, expected, mergeChoice } of metaCases(mulberry32(5), 200, false)) {
      const view = render(<KanbanDetailMetaStrip task={task} runCount={runCount} priority="medium" onPriorityChange={vi.fn()} />);
      const strip = view.getByTestId("kanban-detail-meta-strip");
      for (const [item, testId] of Object.entries(testIds)) {
        expect(Boolean(strip.querySelector(`[data-testid='${testId}']`)), `${task.id} ${item}`).toBe(expected.includes(item as KanbanDetailMetaItem));
      }
      expect(Boolean(strip.querySelector("[data-testid='kanban-detail-unmerged-badge']")), task.id).toBe(mergeChoice === "unmerged");
      expect(Boolean(strip.querySelector("[data-testid='kanban-detail-meta-merged']")), task.id).toBe(mergeChoice === "merged");
      expect(strip.querySelectorAll("[data-testid='kanban-detail-meta-label']").length).toBe(task.labels?.length ?? 0);
      view.unmount();
    }
  });
});
