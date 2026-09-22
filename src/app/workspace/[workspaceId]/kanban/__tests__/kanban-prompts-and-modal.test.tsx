import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KanbanMoveBlockedModal } from "../kanban-tab-modals";
import { buildKanbanSessionRestorePrompt } from "../kanban-tab-panels";
import { buildKanbanMoveBlockedRemediationPrompt } from "../i18n/kanban-task-agent";
import { createDetailTask, detailBoard } from "./kanban-detail-fixtures";

vi.mock("@/client/components/repo-picker", () => ({
  RepoPicker: () => <div data-testid="repo-picker-mock" />,
  shortenRepoPath: (value: string) => value,
}));

const board = detailBoard;
const createTask = createDetailTask;

describe("kanban session restore prompt", () => {
  it("uses card context and filters noisy tool or terminal transcript", () => {
    const prompt = buildKanbanSessionRestorePrompt(
      createTask("task-restore", "Upgrade dirs", {
        objective: "Update dirs requirement from 5 to 6",
        status: "IN_PROGRESS",
      }),
      {
        sessionId: "session-old",
        name: "Upgrade dirs · Dev Crafter",
        workspaceId: "workspace-1",
        cwd: "/tmp/worktree",
        branch: "issue/dirs",
        provider: "codex",
        createdAt: "2025-01-01T00:00:00.000Z",
      },
      [
        {
          role: "terminal",
          content: "cargo test --all\nrunning 100 tests\n...",
        },
        {
          role: "assistant",
          content: "2026-04-09T04:03:47.306949Z INFO routa_server: Starting Routa backend server on 127.0.0.1:0\n".repeat(20),
        },
        {
          role: "tool",
          toolName: "shell",
          content: "test result: ok. 8 passed; 0 failed",
        },
        {
          role: "assistant",
          content: "cargo test --all passed; cargo clippy is the remaining verification.",
        },
      ],
    );

    expect(prompt).toContain("Card context:");
    expect(prompt).toContain("- Card: Upgrade dirs");
    expect(prompt).toContain("Assistant: cargo test --all passed");
    expect(prompt).not.toContain("Starting Routa backend server");
    expect(prompt).not.toContain("test result: ok");
    expect(prompt).not.toContain("running 100 tests");
  });
});

describe("kanban move-blocked remediation prompt", () => {
  it("requires moving the card after repairing story-readiness fields", () => {
    const prompt = buildKanbanMoveBlockedRemediationPrompt({
      workspaceId: "workspace-1",
      boardId: "board-1",
      cardId: "card-1",
      cardTitle: "Repair story readiness",
      targetColumnId: "review",
      repoPath: "/tmp/repo",
      missingFields: ["scope", "verification plan"],
    });

    expect(prompt).toContain("you must call move_card to move card card-1 into review");
    expect(prompt).not.toContain("Do not move the card");
  });

  it("requires the Chinese remediation agent to move the card after repair", () => {
    const prompt = buildKanbanMoveBlockedRemediationPrompt({
      workspaceId: "workspace-1",
      boardId: "board-1",
      cardId: "card-1",
      cardTitle: "修复 story-readiness",
      targetColumnId: "review",
      repoPath: "/tmp/repo",
      missingFields: ["scope", "verification plan"],
      language: "zh-CN",
    });

    expect(prompt).toContain("必须调用 move_card，把 card card-1 移动到 review");
    expect(prompt).not.toContain("不要移动卡片");
  });
});

describe("kanban move blocked modal", () => {
  it("surfaces story-readiness remediation with update_task guidance", () => {
    render(
      <KanbanMoveBlockedModal
        blocked={{
          message: 'Cannot move task to "Dev": missing required task fields: scope, verification plan.',
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
          missingTaskFields: ["scope", "verification plan"],
        }}
        onClose={vi.fn()}
        onDelegateFix={vi.fn()}
        onOpenCard={vi.fn()}
      />,
    );

    expect(screen.getByText("Cannot Move Card")).toBeTruthy();
    expect(screen.getByText("This move is blocked by the story-readiness gate for the target lane.")).toBeTruthy();
    expect(screen.getByText(/Required for next move:/)).toBeTruthy();
    expect(screen.getByText(/Missing fields:/)).toBeTruthy();
    expect(screen.getByText(/Use `update_task` to fill structured fields/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ask Kanban Agent to Fix" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open" })).toBeTruthy();
  });
});

