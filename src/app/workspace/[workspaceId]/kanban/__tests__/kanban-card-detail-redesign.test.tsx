import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KanbanCardDetail, type KanbanCardDetailProps } from "../kanban-card-detail";
import type { TaskInfo } from "../../types";
import { resetDesktopAwareFetchToGlobalFetch } from "./test-utils";
import { createDetailTask, detailBoard } from "./kanban-detail-fixtures";

/**
 * Card detail redesign (card 3/6): four tabs, toolbar, property rail,
 * load states and keyboard. Kept out of kanban-tab.test.tsx (frozen size).
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

describe("card detail redesign: tabs (AC4/AC14)", () => {
  it("shows exactly the four tabs in order", () => {
    renderDetail({ id: "four-tabs" });
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Overview",
      "Construction",
      "Changes & Evidence",
      "Completion",
    ]);
    expect(screen.queryByRole("tab", { name: /Plain Language|人话版/ })).toBeNull();
  });

  it("moves between the four tabs with the arrow keys", () => {
    renderDetail({ id: "arrow-tabs" });
    const overview = screen.getByRole("tab", { name: "Overview" });
    fireEvent.keyDown(overview, { key: "ArrowRight" });
    expect(activeTabName()).toBe("Construction");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Construction" }), { key: "ArrowRight" });
    expect(activeTabName()).toBe("Changes & Evidence");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Changes & Evidence" }), { key: "ArrowLeft" });
    expect(activeTabName()).toBe("Construction");
  });
});

describe("card detail redesign: toolbar and title (AC2)", () => {
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

describe("card detail redesign: overview (AC5)", () => {
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
    expect(screen.getByTestId("kanban-detail-readiness")).toBeTruthy();

    fireEvent.click(within(screen.getByTestId("kanban-detail-description")).getByRole("button", { name: "Edit" }));
    expect(within(screen.getByTestId("kanban-detail-description")).getByRole("button", { name: "Save" })).toBeTruthy();
    fireEvent.click(screen.getByTestId("kanban-detail-test-cases-edit"));
    expect(screen.getByRole("textbox", { name: "Test Cases" })).toBeTruthy();
  });

  it("story readiness shows 'Pending evaluation' instead of passing fields it has no verdict for", () => {
    renderDetail({ id: "readiness-pending" });
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    fireEvent.click(within(screen.getByTestId("kanban-detail-readiness")).getByText("Story Readiness").closest("summary")!);
    const readiness = screen.getByTestId("kanban-story-readiness");
    expect(within(readiness).getAllByText("Pending evaluation").length).toBeGreaterThanOrEqual(13);
    expect(within(readiness).queryByText("Present")).toBeNull();
  });
});

describe("card detail redesign: construction (AC6)", () => {
  it("keeps the advanced area collapsed until opened, then shows the merged model picker with Follow default", async () => {
    renderDetail({ id: "advanced-closed" });
    fireEvent.click(screen.getByRole("tab", { name: "Construction" }));

    const advanced = screen.getByTestId("kanban-detail-advanced");
    expect(advanced.hasAttribute("open")).toBe(false);
    expect(screen.queryByText("Card session override")).toBeNull();
    expect(screen.queryByTestId("kanban-detail-model-effort-override")).toBeNull();

    fireEvent.click(within(advanced).getByText("Advanced").closest("summary")!);
    expect(advanced.hasAttribute("open")).toBe(true);
    fireEvent.click(screen.getByText("Card session override").closest("summary")!);
    expect(screen.getByTestId("kanban-detail-model-effort-override")).toBeTruthy();
    fireEvent.click(screen.getByTestId("kanban-detail-override-model-effort"));
    const panel = await screen.findByTestId("kanban-detail-override-model-effort-panel");
    expect(within(panel).getAllByRole("option")[0]?.textContent).toBe("Follow default");
    expect(within(advanced).getByTestId("kanban-detail-fallback-chain")).toBeTruthy();
    expect(within(advanced).getByTestId("kanban-detail-handoffs")).toBeTruthy();
    expect(within(advanced).getByTestId("kanban-detail-github")).toBeTruthy();
  });

  it("does not offer Recover for a session that ended normally", () => {
    renderDetail({
      id: "ended-session",
      columnId: "done",
      triggerSessionId: "session-ended",
      laneSessions: [{ sessionId: "session-ended", columnId: "done", columnName: "Done", status: "completed", startedAt: "2026-10-22T00:00:00.000Z" }],
    });
    fireEvent.click(screen.getByRole("tab", { name: "Construction" }));
    expect(screen.queryByRole("button", { name: /Recover Live Run/i })).toBeNull();
    expect(screen.queryByText(/Current run failed/i)).toBeNull();
    expect(screen.getAllByText("Ended").length).toBeGreaterThan(0);
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
    fireEvent.click(screen.getByRole("tab", { name: "Construction" }));
    expect(screen.getByRole("button", { name: /Recover Live Run/i })).toBeTruthy();
  });

  it("labels runs without a recorded model as not recorded instead of the current config", () => {
    renderDetail({
      id: "run-model",
      laneSessions: [{ sessionId: "session-a", columnId: "dev", provider: "dsh", status: "completed", startedAt: "2026-10-22T00:00:00.000Z" }],
    });
    fireEvent.click(screen.getByRole("tab", { name: "Construction" }));
    expect(screen.getByTestId("kanban-run-model-chip").textContent).toBe("Model not recorded");
    expect(screen.getByTestId("kanban-run-effort-chip").textContent).toBe("Effort not recorded");
  });
});

describe("card detail redesign: property rail (AC9)", () => {
  const unmergedTask: Partial<TaskInfo> = {
    columnId: "done",
    deliveryLanding: { landedOnBase: false, commitsSinceBase: 3 } as TaskInfo["deliveryLanding"],
  };

  it("shows the amber 'Not merged to base' badge when landing says unmerged", () => {
    renderDetail({ id: "rail-unmerged", ...unmergedTask });
    const rail = screen.getByTestId("kanban-detail-property-rail");
    expect(within(rail).getByTestId("kanban-detail-unmerged-badge").textContent).toBe("Not merged to base");
    expect(within(rail).getByTestId("kanban-detail-unmerged-badge").closest("[data-tone]")?.getAttribute("data-tone")).toBe("attention");
  });

  it("hides the badge without clear landing evidence", () => {
    renderDetail({ id: "rail-unknown", columnId: "done" });
    expect(screen.queryByTestId("kanban-detail-unmerged-badge")).toBeNull();
    renderDetail({ id: "rail-landed", columnId: "done", deliveryLanding: { landedOnBase: true, commitsSinceBase: 2 } as TaskInfo["deliveryLanding"] });
    expect(screen.queryByTestId("kanban-detail-unmerged-badge")).toBeNull();
  });

  it("shows GitHub only when linked and lists the labels", () => {
    renderDetail({ id: "rail-labels", labels: ["req:routa-redesign", "dsh-origin:session-1"] });
    const rail = screen.getByTestId("kanban-detail-property-rail");
    expect(within(rail).queryByText("GitHub")).toBeNull();
    expect(within(rail).getByText("req:routa-redesign")).toBeTruthy();
    expect(within(rail).getByText("dsh-origin:session-1")).toBeTruthy();
  });

  it("delete asks the board for its in-app confirm dialog instead of window.confirm", () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const { onDelete } = renderDetail({ id: "rail-delete" });
    fireEvent.click(screen.getByTestId("kanban-detail-delete"));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});

describe("card detail redesign: load states (AC11)", () => {
  it("shows a skeleton while the full record loads", () => {
    renderDetail({ id: "loading" }, { loadState: { loading: true, error: null, onRetry: vi.fn() } });
    expect(screen.getByTestId("kanban-detail-loading")).toBeTruthy();
    expect(screen.getByTestId("ui-skeleton")).toBeTruthy();
    // Title and properties from the summary stay visible.
    expect(screen.getByDisplayValue("Redesign card")).toBeTruthy();
    expect(screen.getByTestId("kanban-detail-property-rail")).toBeTruthy();
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

describe("card detail redesign: completion (AC8)", () => {
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
