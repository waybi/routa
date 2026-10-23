import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KanbanCardDetail, type KanbanCardDetailProps } from "../kanban-card-detail";
import type { KanbanColumnInfo, TaskInfo } from "../../types";
import { resetDesktopAwareFetchToGlobalFetch } from "./test-utils";
import { createDetailTask } from "./kanban-detail-fixtures";

/**
 * Card 8a2d2555 AC16: every control that the detail before the redesign
 * (0ffb1eed kanban-card-detail.tsx / kanban-card-activity.tsx) showed
 * directly is still directly visible — no Advanced area, no closed outer
 * <details>, no hidden / hover-only wrapper. Areas that were collapsed in
 * the old detail itself (card session override without an override,
 * fallback agent chain editor, repositories, earlier completion reports)
 * only need their summary row visible.
 *
 * The run / rerun / reset / failure / lane-artifact controls need a card in
 * a running lane ("dev"); the merge badge needs a Done card. So the table
 * renders one of two cards, both with every other condition met.
 */

const { desktopAwareFetch } = vi.hoisted(() => ({ desktopAwareFetch: vi.fn() }));

vi.mock("@/client/utils/diagnostics", async () => {
  const actual = await vi.importActual<typeof import("@/client/utils/diagnostics")>("@/client/utils/diagnostics");
  return { ...actual, desktopAwareFetch };
});

// No run ledger: the run count falls back to the card's session ids.
vi.mock("../use-task-runs", () => ({ useTaskRuns: () => ({ runs: null, error: null }) }));

beforeEach(() => {
  resetDesktopAwareFetchToGlobalFetch(desktopAwareFetch);
  desktopAwareFetch.mockImplementation(async () => new Response(JSON.stringify({ artifacts: [], runs: [] }), { status: 200 }));
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

const columns: KanbanColumnInfo[] = [
  { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
  { id: "todo", name: "Todo", position: 1, stage: "todo" },
  {
    id: "dev",
    name: "Dev",
    position: 2,
    stage: "dev",
    automation: { enabled: true, steps: [{ id: "s1", providerId: "claude", role: "CRAFTER" }], requiredArtifacts: ["screenshot"] },
  },
  { id: "review", name: "Review", position: 3, stage: "review", automation: { enabled: true, requiredArtifacts: ["test_results"] } },
  { id: "done", name: "Done", position: 4, stage: "done" },
];

const laneSessions: NonNullable<TaskInfo["laneSessions"]> = [
  { sessionId: "s-1", columnId: "todo", columnName: "Todo", status: "completed", startedAt: "2026-10-20T00:00:00.000Z" },
  { sessionId: "s-2", columnId: "dev", columnName: "Dev", status: "completed", startedAt: "2026-10-21T00:00:00.000Z" },
  { sessionId: "s-3", columnId: "review", columnName: "Review", status: "completed", startedAt: "2026-10-22T00:00:00.000Z" },
];

const fullConditions: Partial<TaskInfo> = {
  priority: "high",
  labels: ["req:routa-redesign", "dsh-origin:session-1"],
  sessionIds: ["s-1", "s-2", "s-3"],
  triggerSessionId: "s-3",
  laneSessions,
  laneHandoffs: [{
    id: "h-1",
    fromSessionId: "s-3",
    toSessionId: "s-2",
    requestType: "environment_preparation",
    request: "Start the preview server",
    status: "completed",
    requestedAt: "2026-10-22T01:00:00.000Z",
    responseSummary: "Preview is up",
  }],
  githubNumber: 42,
  githubUrl: "https://github.com/o/r/issues/42",
  githubRepo: "o/r",
  githubState: "open",
  githubSyncedAt: "2026-10-22T02:00:00.000Z",
  // Differs from the Dev lane step (claude / CRAFTER), so it is a card override.
  assignedProvider: "claude",
  assignedRole: "DEVELOPER",
  verificationVerdict: "NOT_APPROVED",
  verificationReport: "AC3 failed.",
  testCases: ["Opens on overview"],
  comments: [
    { id: "n1", body: "Note body", createdAt: "2026-10-22T01:00:00.000Z", source: "update_card" },
    { id: "r1", body: "## Completion Summary\nFirst", createdAt: "2026-10-22T02:00:00.000Z", source: "update_card" },
    { id: "r2", body: "## Completion Summary\nSecond", createdAt: "2026-10-22T03:00:00.000Z", source: "update_card" },
  ],
  storyReadiness: {
    ready: false,
    missing: ["scope"],
    requiredTaskFields: ["scope", "acceptance_criteria"],
    checks: { scope: false, acceptanceCriteria: true, verificationCommands: true, testCases: true, verificationPlan: true, dependenciesDeclared: true },
  },
  investValidation: {
    source: "canonical_story",
    overallStatus: "warning",
    checks: {
      independent: { status: "pass", reason: "ok" },
      negotiable: { status: "pass", reason: "ok" },
      valuable: { status: "pass", reason: "ok" },
      estimable: { status: "pass", reason: "ok" },
      small: { status: "warning", reason: "big" },
      testable: { status: "pass", reason: "ok" },
    },
    issues: [],
  },
  evidenceSummary: {
    artifact: { total: 1, byType: { screenshot: 1 }, requiredSatisfied: true, missingRequired: [] },
    verification: { hasVerdict: true, hasReport: true },
    completion: { hasSummary: true },
    runs: { total: 3, latestStatus: "completed" },
  },
  deliveryReadiness: { checked: true, commitsSinceBase: 3, hasCommitsSinceBase: true, landedOnBase: false } as TaskInfo["deliveryReadiness"],
  deliveryLanding: { landedOnBase: false, commitsSinceBase: 3 } as TaskInfo["deliveryLanding"],
};

const doneCard = createDetailTask("visible-done", "Visible card", { ...fullConditions, columnId: "done" });
const devCard = createDetailTask("visible-dev", "Visible card", { ...fullConditions, columnId: "dev", lastSyncError: "provider exited" });

function renderDetail(task: TaskInfo, props: Partial<KanbanCardDetailProps> = {}) {
  return render(
    <KanbanCardDetail
      task={task}
      boardColumns={columns}
      availableProviders={[{ id: "claude", name: "Claude Code", description: "", command: "claude", status: "available" }]}
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
      {...props}
    />,
  );
}

// Classes that hide an element or only show it on hover.
const HIDING_CLASS = /^(hidden|invisible|opacity-0|sr-only)$|^group-hover:(opacity|visible|block|flex|inline|grid)/;

/** Fails when the element sits in a closed <details> (outside its summary) or a hidden / hover-only wrapper. */
function expectDirectlyVisible(element: Element) {
  for (let node: Element | null = element; node && node !== document.body; node = node.parentElement) {
    if (node.tagName === "DETAILS" && !(node as HTMLDetailsElement).open) {
      const summary = Array.from(node.children).find((child) => child.tagName === "SUMMARY");
      expect(summary?.contains(element), `inside a closed <details>: ${node.outerHTML.slice(0, 120)}`).toBe(true);
    }
    expect(node.hasAttribute("hidden"), `hidden ancestor: ${node.tagName}`).toBe(false);
    for (const token of Array.from(node.classList)) {
      expect(HIDING_CLASS.test(token), `hiding class "${token}" on ${node.tagName}`).toBe(false);
    }
  }
}

type Tab = "Overview" | "Story Readiness" | "Execution" | "History Memory" | "Changes" | "Evidence Bundle" | "Runs" | "Completion";

const strip = () => screen.getByTestId("kanban-detail-meta-strip");
const panel = (id: string) => screen.getByTestId(`kanban-detail-panel-${id}`);
const summaryOf = (text: string) => screen.getByText(text).closest("summary") as HTMLElement;

/**
 * name | 0ffb1eed file:line | tab to open | card | how to find it now.
 * Condition: the full card (see fullConditions); "dev" rows need a card in
 * an automated lane, which the old detail also needed for these controls.
 */
const VISIBLE_CONTROLS: Array<[string, string, Tab, "done" | "dev", () => Element]> = [
  ["title (click to edit)", "kanban-card-detail.tsx:360", "Overview", "done", () => screen.getByRole("textbox", { name: "Card title" })],
  ["meta: priority dropdown", "kanban-card-detail.tsx:420", "Overview", "done", () => within(strip()).getByRole("combobox", { name: "Priority" })],
  ["meta: column", "kanban-card-detail.tsx:436", "Overview", "done", () => within(strip()).getByTestId("kanban-detail-meta-column")],
  ["meta: run count", "kanban-card-detail.tsx:438", "Overview", "done", () => within(strip()).getByTestId("kanban-detail-meta-runs")],
  ["meta: story readiness", "kanban-card-detail.tsx:440", "Overview", "done", () => within(strip()).getByTestId("kanban-detail-meta-readiness")],
  ["meta: evidence", "kanban-card-detail.tsx:444", "Overview", "done", () => within(strip()).getByTestId("kanban-detail-meta-evidence")],
  ["meta: GitHub", "kanban-card-detail.tsx:447", "Overview", "done", () => within(strip()).getByRole("link", { name: "#42" })],
  ["meta: commits", "kanban-card-detail.tsx:449", "Overview", "done", () => within(strip()).getByTestId("kanban-detail-meta-commits")],
  ["meta: merge state", "kanban-card-detail.tsx:456", "Overview", "done", () => within(strip()).getByTestId("kanban-detail-unmerged-badge")],
  ["meta: labels", "kanban-card-detail.tsx:463", "Overview", "done", () => within(strip()).getAllByTestId("kanban-detail-meta-label")[1]!],
  ["delete task", "kanban-card-detail.tsx:829", "Runs", "done", () => screen.getByTestId("kanban-detail-delete")],
  ...(["Overview", "Story Readiness", "Execution", "History Memory", "Changes", "Evidence Bundle", "Runs", "Completion"] as Tab[]).map(
    (name) => [`tab: ${name}`, "kanban-card-detail.tsx:335", "Completion", "done", () => screen.getByRole("tab", { name })] as [string, string, Tab, "done" | "dev", () => Element],
  ),
  ["overview: description edit", "kanban-card-detail.tsx:520", "Overview", "done", () => within(screen.getByTestId("kanban-detail-description")).getByRole("button", { name: "Edit" })],
  ["overview: review feedback", "kanban-card-detail.tsx:544", "Overview", "done", () => screen.getByTestId("kanban-review-feedback")],
  ["overview: progress notes", "kanban-card-detail.tsx:548", "Overview", "done", () => within(screen.getByTestId("kanban-detail-progress-notes")).getByText("Note body")],
  ["overview: completion report link", "kanban-card-detail.tsx:599", "Overview", "done", () => screen.getByTestId("kanban-completion-report-pointer")],
  ["overview: test cases edit", "kanban-card-detail.tsx:658", "Overview", "done", () => screen.getByTestId("kanban-detail-test-cases-edit")],
  ["readiness: verdict badge", "kanban-detail-panels.tsx:800", "Story Readiness", "done", () => within(screen.getByTestId("kanban-story-readiness")).getByText("Blocked for Dev")],
  ["readiness: missing fields", "kanban-detail-panels.tsx:810", "Story Readiness", "done", () => within(screen.getByTestId("kanban-story-readiness")).getByText(/^Missing fields:/)],
  ["readiness: checks", "kanban-detail-panels.tsx:815", "Story Readiness", "done", () => within(screen.getByTestId("kanban-story-readiness")).getByText("Scope")],
  ["readiness: INVEST", "kanban-detail-panels.tsx:854", "Story Readiness", "done", () => within(screen.getByTestId("kanban-story-readiness")).getByText("INVEST Summary")],
  ["execution: lane + inherited", "kanban-card-detail.tsx:1105", "Execution", "dev", () => within(panel("execution")).getByText("Inherited from the current lane.")],
  ["execution: automation badge", "kanban-card-detail.tsx:1109", "Execution", "dev", () => within(panel("execution")).getByText("Automation on")],
  ["execution: lane pipeline", "kanban-card-detail.tsx:1114", "Execution", "dev", () => within(panel("execution")).getByText("Lane pipeline")],
  ["execution: current run target", "kanban-card-detail.tsx:1120", "Execution", "dev", () => within(panel("execution")).getByText("Current run")],
  ["execution: lane artifacts", "kanban-card-detail.tsx:1131", "Execution", "dev", () => within(panel("execution")).getAllByText(/Screenshot|Test Results/)[0]!],
  ["execution: failure reason", "kanban-card-detail.tsx:1242", "Execution", "dev", () => within(panel("execution")).getByText(/provider exited/)],
  ["execution: reset override", "kanban-card-detail.tsx:1272", "Execution", "dev", () => within(panel("execution")).getByRole("button", { name: "Reset override" })],
  ["execution: run / rerun", "kanban-card-detail.tsx:1280", "Execution", "dev", () => screen.getByTestId("kanban-detail-run")],
  ["execution: card session override row", "kanban-card-detail.tsx:1165", "Execution", "dev", () => summaryOf("Card session override")],
  ["execution: Edit override button", "kanban-card-detail.tsx:1172", "Execution", "dev", () => within(summaryOf("Card session override")).getByText("Edit override")],
  ["execution: override provider dropdown", "kanban-card-detail.tsx:1180", "Execution", "dev", () => screen.getByTestId("kanban-detail-provider-override")],
  ["execution: override model + effort", "kanban-card-detail.tsx:1190", "Execution", "dev", () => screen.getByTestId("kanban-detail-override-model-effort")],
  ["execution: override role", "kanban-card-detail.tsx:1196", "Execution", "dev", () => within(panel("execution")).getByRole("combobox", { name: "Card session override" })],
  ["execution: override specialist", "kanban-card-detail.tsx:1208", "Execution", "dev", () => within(panel("execution")).getByRole("option", { name: "No specialist" }).closest("select")!],
  ["execution: fallback chain row", "kanban-card-detail.tsx:1333", "Execution", "dev", () => summaryOf("Fallback agent chain")],
  ["execution: repositories row", "kanban-card-detail.tsx:1469", "Execution", "dev", () => within(screen.getByTestId("kanban-detail-repositories")).getByText("Repo").closest("summary")!],
  ["history memory panel", "kanban-card-detail.tsx:784", "History Memory", "done", () => screen.getByTestId("kanban-detail-history-memory")],
  ["changes panel", "kanban-card-detail.tsx:716", "Changes", "done", () => screen.getByTestId("kanban-detail-changes-section")],
  ["evidence bundle panel", "kanban-card-detail.tsx:736", "Evidence Bundle", "done", () => screen.getByTestId("kanban-evidence-bundle")],
  ["evidence: artifacts list", "kanban-card-detail.tsx:739", "Evidence Bundle", "done", () => within(panel("evidence")).getByText("Artifacts")],
  ["runs: Run records N", "kanban-card-activity.tsx:344", "Runs", "done", () => screen.getByTestId("kanban-activity-subtab-runs")],
  ["runs: Handoffs N", "kanban-card-activity.tsx:345", "Runs", "done", () => screen.getByTestId("kanban-activity-subtab-handoffs")],
  ["runs: GitHub", "kanban-card-activity.tsx:346", "Runs", "done", () => screen.getByTestId("kanban-activity-subtab-github")],
  ["completion: latest report", "kanban-card-detail.tsx:860", "Completion", "done", () => within(screen.getByTestId("kanban-completion-report")).getByText("Second")],
  ["completion: earlier reports row", "kanban-card-detail.tsx:875", "Completion", "done", () => screen.getByText("Earlier completion reports (1)").closest("summary")!],
];

describe("old detail controls stay directly visible (AC16)", () => {
  it.each(VISIBLE_CONTROLS)("%s (%s)", (_name, _oldLine, tab, card, find) => {
    renderDetail(card === "done" ? doneCard : devCard);
    fireEvent.click(screen.getByRole("tab", { name: tab }));
    const element = find();
    expect(element).toBeTruthy();
    expectDirectlyVisible(element);
    expect(screen.queryByText("Advanced")).toBeNull();
  });

  it.each([
    ["handoffs", "kanban-detail-handoffs", "Start the preview server"],
    ["github", "kanban-detail-github", "o/r"],
  ])("runs sub-tab %s shows its content directly (kanban-card-activity.tsx:400-410)", (tab, testId, text) => {
    renderDetail(doneCard);
    fireEvent.click(screen.getByRole("tab", { name: "Runs" }));
    fireEvent.click(screen.getByTestId(`kanban-activity-subtab-${tab}`));
    const content = within(screen.getByTestId(testId)).getByText(text);
    expectDirectlyVisible(content);
  });

  it("GitHub sub-tab shows state, repo, #number link and sync time (kanban-card-activity.tsx:875-891)", () => {
    renderDetail(doneCard);
    fireEvent.click(screen.getByRole("tab", { name: "Runs" }));
    fireEvent.click(screen.getByTestId("kanban-activity-subtab-github"));
    const github = screen.getByTestId("kanban-detail-github");
    expect(within(github).getByText("open")).toBeTruthy();
    expect(within(github).getByText("o/r")).toBeTruthy();
    expect(within(github).getByRole("link", { name: "#42" }).getAttribute("href")).toBe("https://github.com/o/r/issues/42");
    expect(within(github).getByText(/^Synced/)).toBeTruthy();
  });
});

describe("old collapsed areas keep their old behaviour (AC16)", () => {
  const overrideDetails = () => summaryOf("Card session override").parentElement as HTMLDetailsElement;

  it("card session override is open when the card has an override", () => {
    renderDetail(devCard);
    fireEvent.click(screen.getByRole("tab", { name: "Execution" }));
    expect(overrideDetails().tagName).toBe("DETAILS");
    expect(overrideDetails().open).toBe(true);
  });

  it("card session override stays collapsed (summary visible) without an override", () => {
    renderDetail({ ...devCard, assignedProvider: undefined, assignedRole: undefined });
    fireEvent.click(screen.getByRole("tab", { name: "Execution" }));
    expect(overrideDetails().open).toBe(false);
    expectDirectlyVisible(summaryOf("Card session override"));
    expect(within(summaryOf("Card session override")).getByText("Override this card")).toBeTruthy();
  });

  it("fallback chain, repositories and earlier reports are collapsed with a visible summary", () => {
    renderDetail(devCard);
    fireEvent.click(screen.getByRole("tab", { name: "Execution" }));
    expect((screen.getByTestId("kanban-detail-fallback-chain") as HTMLDetailsElement).open).toBe(false);
    expect((within(screen.getByTestId("kanban-detail-repositories")).getByText("Repo").closest("details") as HTMLDetailsElement).open).toBe(false);
    fireEvent.click(screen.getByRole("tab", { name: "Completion" }));
    expect((screen.getByText("Earlier completion reports (1)").closest("details") as HTMLDetailsElement).open).toBe(false);
  });

  it("the run button still shows a disabled 'Starting…' on click (84c9e372)", () => {
    const onRetryTrigger = vi.fn(() => new Promise<void>(() => {}));
    renderDetail(devCard, { onRetryTrigger });
    fireEvent.click(screen.getByRole("tab", { name: "Execution" }));
    const run = screen.getByTestId("kanban-detail-run") as HTMLButtonElement;
    fireEvent.click(run);
    expect(run.disabled).toBe(true);
    expect(run.textContent).toBe("Starting…");
    expect(onRetryTrigger).toHaveBeenCalledTimes(1);
  });
});
