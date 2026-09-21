/**
 * Characterization tests for the Kanban feedback states added in
 * docs/exec-plans/active/kanban-ux-feedback.md Phase 1.
 *
 * These lock the behavior that was previously missing: an async action must
 * show that it is running, and a failed action must say so on screen instead
 * of only in the browser console.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TaskInfo } from "../../types";
import { EMPTY_DRAFT } from "../../kanban-create-modal";
import { KanbanCreateTaskModal } from "../kanban-tab-panels";
import { KanbanDeleteTaskModal, KanbanWorktreeCleanupModal } from "../kanban-tab-modals";

const draft = {
  ...EMPTY_DRAFT,
  title: "Demo card",
  objectiveHtml: "<p>Demo objective</p>",
};

const task: TaskInfo = {
  id: "task-1",
  workspaceId: "workspace-1",
  boardId: "board-1",
  columnId: "dev",
  title: "Demo card",
  objective: "Demo objective",
  status: "IN_PROGRESS",
  priority: "medium",
  position: 0,
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
} as TaskInfo;

describe("KanbanCreateTaskModal feedback", () => {
  it("shows an idle submit button that is clickable", () => {
    const onCreate = vi.fn();
    render(
      <KanbanCreateTaskModal
        showCreateModal
        draft={draft}
        setDraft={vi.fn()}
        onClose={vi.fn()}
        onCreate={onCreate}
        githubAvailable={false}
        codebases={[]}
        allCodebaseIds={[]}
      />,
    );

    const submit = screen.getByTestId("kanban-create-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("disables the submit button and swaps the label while creating", () => {
    const onCreate = vi.fn();
    render(
      <KanbanCreateTaskModal
        showCreateModal
        draft={draft}
        setDraft={vi.fn()}
        onClose={vi.fn()}
        onCreate={onCreate}
        creating
        githubAvailable={false}
        codebases={[]}
        allCodebaseIds={[]}
      />,
    );

    const submit = screen.getByTestId("kanban-create-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(submit.textContent).toContain("Creating card");
    fireEvent.click(submit);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("renders the server error inline so the failure is visible", () => {
    render(
      <KanbanCreateTaskModal
        showCreateModal
        draft={draft}
        setDraft={vi.fn()}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        createError="boom from server"
        githubAvailable={false}
        codebases={[]}
        allCodebaseIds={[]}
      />,
    );

    const error = screen.getByTestId("kanban-create-error");
    expect(error.textContent).toContain("boom from server");
    // The modal stays open so the draft is not lost.
    expect(screen.getByTestId("kanban-create-submit")).toBeTruthy();
  });
});

describe("KanbanDeleteTaskModal feedback", () => {
  it("surfaces the delete failure instead of silently keeping the modal open", () => {
    render(
      <KanbanDeleteTaskModal
        deleteConfirmTask={task}
        isDeleting={false}
        deleteError="delete exploded"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByTestId("kanban-delete-error").textContent).toContain("delete exploded");
  });

  it("does not render an error block on the happy path", () => {
    render(
      <KanbanDeleteTaskModal
        deleteConfirmTask={task}
        isDeleting={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("kanban-delete-error")).toBeNull();
  });
});

describe("KanbanWorktreeCleanupModal", () => {
  it("stays closed when there is no pending prompt", () => {
    render(
      <KanbanWorktreeCleanupModal prompt={null} onConfirm={vi.fn()} onSkip={vi.fn()} />,
    );
    expect(screen.queryByTestId("kanban-worktree-cleanup-modal")).toBeNull();
  });

  it("routes confirm and skip to distinct handlers", () => {
    const onConfirm = vi.fn();
    const onSkip = vi.fn();
    render(
      <KanbanWorktreeCleanupModal
        prompt={{ taskId: "task-1", targetColumnId: "done" }}
        onConfirm={onConfirm}
        onSkip={onSkip}
      />,
    );

    expect(screen.getByTestId("kanban-worktree-cleanup-modal")).toBeTruthy();

    fireEvent.click(screen.getByText("Clean up worktree"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onSkip).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Keep it"));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});
