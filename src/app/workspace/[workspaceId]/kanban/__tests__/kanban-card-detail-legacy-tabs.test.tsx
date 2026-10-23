import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KanbanCardDetail, type KanbanCardDetailProps } from "../kanban-card-detail";
import type { TaskInfo } from "../../types";
import { resetDesktopAwareFetchToGlobalFetch } from "./test-utils";
import { createDetailTask, detailBoard } from "./kanban-detail-fixtures";

/**
 * Card detail with the eight tabs of the detail before the redesign: tab
 * order and contents, toolbar, the meta strip under the title, delete at
 * the bottom, load states and keyboard. Kept out of kanban-tab.test.tsx
 * (frozen size).
 */

const { desktopAwareFetch } = vi.hoisted(() => ({ desktopAwareFetch: vi.fn() }));

vi.mock("@/client/utils/diagnostics", async () => {
  const actual = await vi.importActual<typeof import("@/client/utils/diagnostics")>("@/client/utils/diagnostics");
  return { ...actual, desktopAwareFetch };
});

vi.mock("../use-task-runs", () => ({ useTaskRuns: () => ({ runs: [], error: null }) }));

beforeEach(() => {
  resetDesktopAwareFetchToGlobalFetch(desktopAwareFetch);
  desktopAwareFetch.mockImplementation(async () => new Response(JSON.stringify({ artifacts: [], runs: [] }), { status: 200 }));
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

function renderDetail(taskOverrides: Partial<TaskInfo> = {}, props: Partial<KanbanCardDetailProps> = {}) {
  const task = { ...createDetailTask(taskOverrides.id ?? "task-redesign", "Redesign card"), ...taskOverrides };
  const handlers = {
    onPatchTask: vi.fn(async () => task),
    onRetryTrigger: vi.fn(async () => {}),
    onDelete: vi.fn(),
    onRefresh: vi.fn(),
    onClose: vi.fn(),
  };
  const view = render(
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
      {...handlers}
      {...props}
    />,
  );
  return { ...view, ...handlers, task };
}

function activeTabName(): string | null {
  return screen.getAllByRole("tab").find((tab) => tab.getAttribute("aria-selected") === "true")?.textContent ?? null;
}

const EN_TABS = ["Overview", "Story Readiness", "Execution", "History Memory", "Changes", "Evidence Bundle", "Runs", "Completion"];

describe("card detail: eight tabs (AC2)", () => {
  it("shows exactly the eight tabs in order", () => {
    renderDetail({ id: "eight-tabs" });
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(EN_TABS);
    expect(screen.queryByRole("tab", { name: /Plain Language|人话版|Construction|Changes & Evidence/ })).toBeNull();
  });

  it("the tab row scrolls sideways and never wraps", () => {
    renderDetail({ id: "tab-scroll" }, { fullWidth: false });
    const tablist = screen.getByRole("tablist");
    expect(tablist.className).toContain("overflow-x-auto");
    expect(tablist.className).toContain("whitespace-nowrap");
    expect(tablist.className).not.toContain("flex-wrap");
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab.querySelector("span")?.className).toContain("whitespace-nowrap");
    }
  });

  it("moves between the tabs with the arrow keys", () => {
    renderDetail({ id: "arrow-tabs" });
    fireEvent.keyDown(screen.getByRole("tab", { name: "Overview" }), { key: "ArrowRight" });
    expect(activeTabName()).toBe("Story Readiness");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Story Readiness" }), { key: "ArrowRight" });
    expect(activeTabName()).toBe("Execution");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Execution" }), { key: "ArrowLeft" });
    expect(activeTabName()).toBe("Story Readiness");
  });
});

describe("card detail: toolbar and title (AC2)", () => {
  it("has one close button, at the end of the sticky toolbar", () => {
    const { onClose } = renderDetail({ id: "one-close" });
    const closeButtons = screen.getAllByRole("button", { name: /close card detail/i });
    expect(closeButtons).toHaveLength(1);
    const toolbar = screen.getByTestId("kanban-detail-sticky-toolbar");
    expect(toolbar.className).toContain("sticky");
    expect(closeButtons[0].parentElement?.lastElementChild).toBe(closeButtons[0]);
    expect(within(toolbar).getByRole("button", { name: "Refresh" })).toBeTruthy();
    fireEvent.click(closeButtons[0]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Esc while editing the title only cancels the edit and does not reach the board's close handler", () => {
    const boardEsc = vi.fn();
    window.addEventListener("keydown", boardEsc);
    const { onPatchTask } = renderDetail({ id: "title-esc" });
    const title = screen.getByRole("textbox", { name: "Card title" }) as HTMLTextAreaElement;
    fireEvent.focus(title);
    fireEvent.change(title, { target: { value: "Changed title" } });
    fireEvent.keyDown(title, { key: "Escape" });
    window.removeEventListener("keydown", boardEsc);

    expect(boardEsc).not.toHaveBeenCalled();
    expect(title.value).toBe("Redesign card");
    expect(onPatchTask).not.toHaveBeenCalled();
  });

  it("saves the title with Cmd+Enter", async () => {
    const { onPatchTask } = renderDetail({ id: "title-save" });
    const title = screen.getByRole("textbox", { name: "Card title" });
    fireEvent.focus(title);
    fireEvent.change(title, { target: { value: "Renamed" } });
    fireEvent.keyDown(title, { key: "Enter", metaKey: true });
    await waitFor(() => expect(onPatchTask).toHaveBeenCalledWith("title-save", { title: "Renamed" }));
  });
});

describe("card detail: overview and story readiness (AC3)", () => {
  it("renders the five overview blocks and lets description and test cases enter edit mode", () => {
    renderDetail({
      id: "overview-blocks",
      columnId: "dev",
      verificationVerdict: "NOT_APPROVED",
      verificationReport: "AC3 failed.",
      testCases: ["Opens on overview"],
      comments: [
        { id: "n1", body: "Note body", createdAt: "2026-10-22T01:00:00.000Z", source: "update_card", agentId: "agent-1" },
        { id: "r1", body: "## Completion Summary\nShipped", createdAt: "2026-10-22T02:00:00.000Z", source: "update_card" },
      ],
    });
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));

    expect(screen.getByTestId("kanban-detail-description")).toBeTruthy();
    expect(screen.getByTestId("kanban-review-verdict").textContent).toBe("Returned to Dev");
    expect(screen.getByText("AC3 failed.")).toBeTruthy();
    const notes = screen.getByTestId("kanban-detail-progress-notes");
    expect(within(notes).getByText("Note 1")).toBeTruthy();
    expect(within(notes).getByText("Added via update_card")).toBeTruthy();
    expect(within(notes).getByText("agent-1")).toBeTruthy();
    expect(screen.getByTestId("kanban-completion-report-pointer")).toBeTruthy();
    expect(screen.getByText("- Opens on overview")).toBeTruthy();
    // Story readiness has its own tab again.
    expect(screen.queryByTestId("kanban-detail-readiness")).toBeNull();
    expect(screen.queryByTestId("kanban-story-readiness")).toBeNull();

    fireEvent.click(within(screen.getByTestId("kanban-detail-description")).getByRole("button", { name: "Edit" }));
    expect(within(screen.getByTestId("kanban-detail-description")).getByRole("button", { name: "Save" })).toBeTruthy();
    fireEvent.click(screen.getByTestId("kanban-detail-test-cases-edit"));
    expect(screen.getByRole("textbox", { name: "Test Cases" })).toBeTruthy();
  });

  it("story readiness tab shows 'Pending evaluation' instead of passing fields it has no verdict for", () => {
    renderDetail({ id: "readiness-pending" });
    fireEvent.click(screen.getByRole("tab", { name: "Story Readiness" }));
    expect(within(screen.getByTestId("kanban-detail-readiness")).getByText("Story Readiness")).toBeTruthy();
    const readiness = screen.getByTestId("kanban-story-readiness");
    expect(within(readiness).getAllByText("Pending evaluation").length).toBeGreaterThanOrEqual(13);
    expect(within(readiness).queryByText("Present")).toBeNull();
  });
});

describe("card detail: execution (AC3/AC17)", () => {
  it("execution shows the card session override and fallback chain directly, with no Advanced area", async () => {
    renderDetail({ id: "no-advanced" });
    fireEvent.click(screen.getByRole("tab", { name: "Execution" }));

    const panel = screen.getByTestId("kanban-detail-panel-execution");
    expect(within(panel).queryByText("Advanced")).toBeNull();
    expect(within(panel).queryByText("高级")).toBeNull();
    expect(within(panel).getByText("Execution")).toBeTruthy();
    expect(within(panel).getByText("Card session override")).toBeTruthy();
    expect(within(panel).getByTestId("kanban-detail-fallback-chain")).toBeTruthy();
    // Handoffs and GitHub live in the Runs tab now.
    expect(within(panel).queryByTestId("kanban-detail-handoffs")).toBeNull();
    expect(within(panel).queryByTestId("kanban-detail-github")).toBeNull();

    fireEvent.click(screen.getByText("Card session override").closest("summary")!);
    expect(screen.getByTestId("kanban-detail-model-effort-override")).toBeTruthy();
    fireEvent.click(screen.getByTestId("kanban-detail-override-model-effort"));
    const picker = await screen.findByTestId("kanban-detail-override-model-effort-panel");
    expect(within(picker).getAllByRole("option")[0]?.textContent).toBe("Follow default");
  });

  it("does not offer Recover for a session that ended normally", () => {
    renderDetail({
      id: "ended-session",
      columnId: "dev",
      triggerSessionId: "session-ended",
      laneSessions: [{ sessionId: "session-ended", columnId: "dev", columnName: "Dev", status: "completed", startedAt: "2026-10-22T00:00:00.000Z" }],
    }, {
      boardColumns: [{ id: "dev", name: "Dev", position: 0, stage: "dev", automation: { enabled: true, steps: [{ id: "s1", providerId: "dsh", role: "CRAFTER" }] } }],
    });
    fireEvent.click(screen.getByRole("tab", { name: "Execution" }));
    expect(screen.getByTestId("kanban-detail-run").textContent).toBe("Rerun");
    expect(screen.queryByRole("button", { name: /Recover Live Run/i })).toBeNull();
    expect(screen.queryByText(/Current run failed/i)).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Runs" }));
    expect(screen.getAllByText("Ended").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Recover|Resume/i })).toBeNull();
  });

  it("offers Recover only for an expired embedded session failure", () => {
    renderDetail({
      id: "failed-session",
      columnId: "dev",
      triggerSessionId: "session-failed",
      lastSyncError: "embedded ACP processes cannot be resumed on a different instance",
      laneSessions: [{ sessionId: "session-failed", columnId: "dev", status: "failed", startedAt: "2026-10-22T00:00:00.000Z" }],
    }, {
      boardColumns: [{ id: "dev", name: "Dev", position: 0, stage: "dev", automation: { enabled: true, steps: [{ id: "s1", providerId: "dsh", role: "CRAFTER" }] } }],
    });
    fireEvent.click(screen.getByRole("tab", { name: "Execution" }));
    expect(screen.getByRole("button", { name: /Recover Live Run/i })).toBeTruthy();
  });

  it("labels runs without a recorded model as not recorded instead of the current config", () => {
    renderDetail({
      id: "run-model",
      laneSessions: [{ sessionId: "session-a", columnId: "dev", provider: "dsh", status: "completed", startedAt: "2026-10-22T00:00:00.000Z" }],
    });
    fireEvent.click(screen.getByRole("tab", { name: "Runs" }));
    expect(screen.getByTestId("kanban-run-model-chip").textContent).toBe("Model not recorded");
    expect(screen.getByTestId("kanban-run-effort-chip").textContent).toBe("Effort not recorded");
  });
});

describe("card detail: meta strip under the title (AC5)", () => {
  const unmergedTask: Partial<TaskInfo> = {
    columnId: "done",
    deliveryLanding: { landedOnBase: false, commitsSinceBase: 3 } as TaskInfo["deliveryLanding"],
  };

  it("sits after the title and before the tab list; no property rail", () => {
    renderDetail({ id: "strip-order" });
    const strip = screen.getByTestId("kanban-detail-meta-strip");
    const title = screen.getByRole("textbox", { name: "Card title" });
    const tablist = screen.getByRole("tablist");
    expect(title.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(strip.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByTestId("kanban-detail-property-rail")).toBeNull();
  });

  it("a bare card shows only priority and column (no 'Pending evaluation')", () => {
    renderDetail({ id: "strip-bare" });
    const strip = screen.getByTestId("kanban-detail-meta-strip");
    expect(within(strip).getByTestId("kanban-detail-meta-priority")).toBeTruthy();
    expect(within(strip).getByTestId("kanban-detail-meta-column").textContent).toBe("Columnbacklog");
    expect(strip.querySelectorAll("[data-testid^='kanban-detail-meta-']")).toHaveLength(2);
    expect(within(strip).queryByText("Pending evaluation")).toBeNull();
    expect(within(strip).queryByTestId("kanban-detail-unmerged-badge")).toBeNull();
  });

  it("shows the amber 'Not merged to base' badge when landing says unmerged", () => {
    renderDetail({ id: "strip-unmerged", ...unmergedTask });
    const strip = screen.getByTestId("kanban-detail-meta-strip");
    expect(within(strip).getByTestId("kanban-detail-unmerged-badge").textContent).toBe("Not merged to base");
    expect(within(strip).getByTestId("kanban-detail-unmerged-badge").closest("[data-tone]")?.getAttribute("data-tone")).toBe("attention");
  });

  it("hides the badge without clear landing evidence and shows plain text when merged", () => {
    renderDetail({ id: "strip-unknown", columnId: "done" });
    expect(screen.queryByTestId("kanban-detail-unmerged-badge")).toBeNull();
    expect(screen.queryByTestId("kanban-detail-meta-merged")).toBeNull();
    renderDetail({ id: "strip-landed", columnId: "done", deliveryLanding: { landedOnBase: true, commitsSinceBase: 2 } as TaskInfo["deliveryLanding"] });
    expect(screen.queryByTestId("kanban-detail-unmerged-badge")).toBeNull();
    expect(screen.getByTestId("kanban-detail-meta-merged").textContent).toContain("Merged to base");
  });

  it("shows GitHub only when linked (a link when there is a URL) and one chip per label", () => {
    const { unmount } = renderDetail({ id: "strip-labels", labels: ["req:routa-redesign", "dsh-origin:session-1"] });
    const strip = screen.getByTestId("kanban-detail-meta-strip");
    expect(within(strip).queryByText("GitHub")).toBeNull();
    expect(within(strip).getAllByTestId("kanban-detail-meta-label").map((chip) => chip.textContent)).toEqual(["req:routa-redesign", "dsh-origin:session-1"]);
    unmount();
    renderDetail({ id: "strip-github", githubNumber: 42, githubUrl: "https://github.com/o/r/issues/42" });
    const link = within(screen.getByTestId("kanban-detail-meta-github")).getByRole("link", { name: "#42" });
    expect(link.getAttribute("href")).toBe("https://github.com/o/r/issues/42");
  });

  it("changing the priority patches the card", async () => {
    const { onPatchTask, onRefresh } = renderDetail({ id: "strip-priority" });
    fireEvent.change(screen.getByTestId("kanban-detail-meta-priority"), { target: { value: "urgent" } });
    await waitFor(() => expect(onPatchTask).toHaveBeenCalledWith("strip-priority", { priority: "urgent" }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });
});

describe("card detail: delete at the bottom (AC6)", () => {
  it.each(EN_TABS)("is below the %s panel and asks for the in-app confirm dialog", (tabName) => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const { onDelete } = renderDetail({ id: `delete-${tabName}` });
    fireEvent.click(screen.getByRole("tab", { name: tabName }));
    const del = screen.getByTestId("kanban-detail-delete");
    const panel = screen.getByRole("tabpanel");
    expect(panel.compareDocumentPosition(del) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(panel.contains(del)).toBe(false);
    fireEvent.click(del);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});

describe("card detail: load states (AC11)", () => {
  it("shows a skeleton while the full record loads", () => {
    renderDetail({ id: "loading" }, { loadState: { loading: true, error: null, onRetry: vi.fn() } });
    expect(screen.getByTestId("kanban-detail-loading")).toBeTruthy();
    expect(screen.getByTestId("ui-skeleton")).toBeTruthy();
    // Title and properties from the summary stay visible.
    expect(screen.getByDisplayValue("Redesign card")).toBeTruthy();
    expect(screen.getByTestId("kanban-detail-meta-strip")).toBeTruthy();
  });

  it("shows the error state with a working Read again and keeps the summary", () => {
    const onRetry = vi.fn();
    renderDetail({ id: "load-error", testCases: ["Summary stays"] }, { loadState: { loading: false, error: "boom", onRetry } });
    const error = screen.getByTestId("ui-error-state");
    expect(error.textContent).toContain("boom");
    fireEvent.click(within(error).getByRole("button", { name: "Read again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByText("- Summary stays")).toBeTruthy();
  });
});

describe("card detail: completion (AC8)", () => {
  it("is read-only: no edit buttons on the completion tab", () => {
    renderDetail({
      id: "completion-readonly",
      comments: [{ id: "r1", body: "## Completion Summary\nDone", createdAt: "2026-10-22T02:00:00.000Z", source: "update_card" }],
    });
    expect(activeTabName()).toBe("Completion");
    const panel = screen.getByTestId("kanban-completion-report");
    expect(within(panel).queryByRole("button", { name: /edit/i })).toBeNull();
    expect(panel.querySelector("article")?.className).toContain("bg-success-subtle");
  });
});

describe("card detail run button feedback (card 1e7dd356)", () => {
  const devLane = [{ id: "dev", name: "Dev", position: 0, stage: "dev" as const, automation: { enabled: true, steps: [{ id: "s1", providerId: "dsh", role: "CRAFTER" }] } }];
  const failedDevTask: Partial<TaskInfo> = {
    columnId: "dev",
    triggerSessionId: "session-failed",
    laneSessions: [{ sessionId: "session-failed", columnId: "dev", columnName: "Dev", status: "failed", startedAt: "2026-10-23T13:00:00.000Z" }],
  };

  it("shows a disabled 'Starting…' at once and does not send a second request", async () => {
    let finish: () => void = () => {};
    const onRetryTrigger = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    renderDetail({ id: "detail-run-busy", ...failedDevTask }, { boardColumns: devLane, onRetryTrigger });
    fireEvent.click(screen.getByRole("tab", { name: "Execution" }));

    const button = screen.getByTestId("kanban-detail-run") as HTMLButtonElement;
    fireEvent.click(button);
    fireEvent.click(button);

    expect(onRetryTrigger).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("Starting…");
    await act(async () => finish());
    expect((screen.getByTestId("kanban-detail-run") as HTMLButtonElement).disabled).toBe(false);
  });

  it("turns back into 'Rerun' and clickable when the request fails", async () => {
    let fail: (error: Error) => void = () => {};
    const onRetryTrigger = vi.fn(() => new Promise<void>((_resolve, reject) => { fail = reject; }));
    renderDetail({ id: "detail-run-fail", ...failedDevTask }, { boardColumns: devLane, onRetryTrigger });
    fireEvent.click(screen.getByRole("tab", { name: "Execution" }));

    fireEvent.click(screen.getByTestId("kanban-detail-run"));
    await act(async () => fail(new Error("500")));

    const button = screen.getByTestId("kanban-detail-run") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("Rerun");
  });
});
