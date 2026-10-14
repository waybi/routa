import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KanbanCardDetail } from "../kanban-card-detail";
import { isCompletionReportNote, splitCompletionReports } from "../kanban-completion-report";
import { resetDesktopAwareFetchToGlobalFetch } from "./test-utils";
import { createDetailTask, detailBoard } from "./kanban-detail-fixtures";

const { desktopAwareFetch } = vi.hoisted(() => ({
  desktopAwareFetch: vi.fn(),
}));

vi.mock("@/client/utils/diagnostics", async () => {
  const actual = await vi.importActual<typeof import("@/client/utils/diagnostics")>("@/client/utils/diagnostics");
  return { ...actual, desktopAwareFetch };
});

vi.mock("@/client/components/repo-picker", () => ({
  RepoPicker: () => <div data-testid="repo-picker-mock" />,
  shortenRepoPath: (value: string) => value,
}));

vi.mock("../use-runtime-fitness-status", async () => {
  const { mockUseRuntimeFitnessStatus } = await import("./test-utils");
  return { useRuntimeFitnessStatus: mockUseRuntimeFitnessStatus };
});

beforeEach(() => {
  resetDesktopAwareFetchToGlobalFetch(desktopAwareFetch);
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe("completion report helpers", () => {
  it("recognises completion report titles in Chinese and English", () => {
    expect(isCompletionReportNote("## 完成汇报（Done 阶段 · 完成汇报员）\n\n内容")).toBe(true);
    expect(isCompletionReportNote("\n## Completion Summary\n- shipped")).toBe(true);
    expect(isCompletionReportNote("【完工汇报】已交付")).toBe(true);
    expect(isCompletionReportNote("## QA Frontend Findings")).toBe(false);
    expect(isCompletionReportNote("Dev 完成：新增报告，提到了完成汇报")).toBe(false);
    expect(isCompletionReportNote("")).toBe(false);
  });

  it("splits reports out newest first and keeps progress notes in order", () => {
    const entries = [
      { id: "1", body: "进度 A", createdAt: "2026-10-13T10:00:00.000Z" },
      { id: "2", body: "## 完成汇报\n旧", createdAt: "2026-10-13T11:08:00.000Z" },
      { id: "3", body: "进度 B", createdAt: "2026-10-14T01:17:00.000Z" },
      { id: "4", body: "## 完成汇报\n新", createdAt: "2026-10-14T01:19:00.000Z" },
    ];
    const { progressNotes, completionReports } = splitCompletionReports(entries);
    expect(progressNotes.map((e) => e.id)).toEqual(["1", "3"]);
    expect(completionReports.map((e) => e.id)).toEqual(["4", "2"]);
  });
});

function renderDetail(comments: Array<{ id: string; body: string; createdAt: string; source?: "update_card" }>) {
  return render(
    <KanbanCardDetail
      task={{
        ...createDetailTask("task-done", "Finished card"),
        columnId: "done",
        comments,
      }}
      boardColumns={detailBoard.columns}
      availableProviders={[]}
      specialists={[]}
      specialistLanguage="en"
      codebases={[]}
      allCodebaseIds={[]}
      worktreeCache={{}}
      sessions={[]}
      fullWidth
      onPatchTask={vi.fn()}
      onRetryTrigger={vi.fn()}
      onDelete={vi.fn()}
      onRefresh={vi.fn()}
    />,
  );
}

describe("KanbanCardDetail completion tab", () => {
  it("puts the completion tab last and shows the newest report there", () => {
    renderDetail([
      { id: "n1", body: "Progress note one", createdAt: "2026-10-13T10:00:00.000Z", source: "update_card" },
      { id: "n2", body: "## Completion Summary\nOlder report body", createdAt: "2026-10-13T11:08:00.000Z", source: "update_card" },
      { id: "n3", body: "## Completion Summary\nNewest report body", createdAt: "2026-10-14T01:19:00.000Z", source: "update_card" },
    ]);

    const tabs = screen.getAllByRole("tab");
    expect(tabs[tabs.length - 1].textContent).toBe("Completion");

    // Overview no longer renders the reports inline, only a pointer.
    expect(screen.getByText("Progress note one")).toBeTruthy();
    expect(screen.queryByText("Newest report body")).toBeNull();
    fireEvent.click(screen.getByTestId("kanban-completion-report-pointer"));

    const panel = screen.getByTestId("kanban-completion-report");
    expect(panel.textContent).toContain("Newest report body");
    expect(screen.getByText("Earlier completion reports (1)")).toBeTruthy();
  });

  it("shows an empty state when no report exists yet", () => {
    renderDetail([{ id: "n1", body: "Progress note one", createdAt: "2026-10-13T10:00:00.000Z", source: "update_card" }]);
    fireEvent.click(screen.getByRole("tab", { name: "Completion" }));
    expect(screen.getByTestId("kanban-completion-report-empty")).toBeTruthy();
    expect(screen.queryByTestId("kanban-completion-report-pointer")).toBeNull();
  });

  it("keeps the header buttons in a sticky toolbar outside the scrolling header section", () => {
    renderDetail([]);
    const toolbar = screen.getByTestId("kanban-detail-sticky-toolbar");
    expect(toolbar.className).toContain("sticky");
    expect(toolbar.className).toContain("top-0");
    expect(toolbar.closest("section")).toBeNull();
    expect(toolbar.querySelector("button")).toBeTruthy();
  });
});
