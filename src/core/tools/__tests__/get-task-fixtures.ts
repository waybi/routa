/** Shared get_task fixtures (card ed9adb91): the "fixed card" and the 50 x 5000-char card from the contract. */
import { createTask, VerificationVerdict, type Task, type TaskCommentEntry } from "../../models/task";

/** Top-level keys of a get_task reply; the Rust twin asserts the same literal list. */
export const GET_TASK_TOP_KEYS = [
  "acceptanceCriteria", "columnId", "comments", "commentsTotal", "id", "labels", "laneSessions",
  "lastSyncError", "objective", "status", "title", "triggerSessionId", "truncated", "updatedAt",
  "verificationCommands", "verificationReport", "verificationVerdict",
];
export const GET_TASK_LANE_KEYS = ["columnId", "completedAt", "role", "sessionId", "startedAt", "status", "stepName"];
/** taskToCard keys recorded on baseline 46e6bad9 (before this card). */
export const BASELINE_CARD_KEYS = [
  "assignee", "columnId", "comment", "comments", "contextSearchSpec", "createdAt", "description", "id",
  "labels", "position", "priority", "status", "title", "updatedAt",
];
export const MAX_BYTES = 32768;

export const bytes = (value: unknown, pretty = false) => Buffer.byteLength(JSON.stringify(value, null, pretty ? 2 : undefined), "utf8");

export function buildFixedCard(overrides: Partial<Task> = {}): Task {
  const task = createTask({
    id: "task-fixed",
    title: "Fixed card",
    objective: "Ship get_task",
    workspaceId: "default",
    boardId: "board-1",
    columnId: "review",
    acceptanceCriteria: ["AC1 works"],
    verificationCommands: ["npx vitest run src/core/tools"],
    labels: ["req:l296"],
  });
  // Stored out of order on purpose: get_task must return them oldest first.
  task.comments = [
    { id: "c2", body: "second note", createdAt: "2026-10-02T00:00:00.000Z", source: "update_card", sessionId: "s-dev" },
    { id: "c1", body: "first note", createdAt: "2026-10-01T00:00:00.000Z", source: "update_card" },
    { id: "c3", body: "third note", createdAt: "2026-10-03T00:00:00.000Z", source: "update_card", agentId: "a-1" },
  ];
  task.verificationVerdict = VerificationVerdict.NOT_APPROVED;
  task.verificationReport = "Missing tests for AC4";
  task.lastSyncError = "Push rejected";
  task.triggerSessionId = "s-trigger";
  task.laneSessions = [
    {
      sessionId: "s-dev", columnId: "dev", stepName: "Dev Crafter", role: "CRAFTER", status: "completed",
      startedAt: "2026-10-01T00:00:00.000Z", completedAt: "2026-10-01T01:00:00.000Z",
      objective: "x".repeat(5000), cwd: "/tmp/worktree", model: "claude-opus",
    },
    {
      sessionId: "s-trigger", columnId: "review", stepName: "Review Guard", role: "GATE", status: "running",
      startedAt: "2026-10-02T00:00:00.000Z", objective: "y".repeat(5000), cwd: "/tmp/worktree", model: "gpt",
    },
  ];
  task.createdAt = new Date("2026-09-30T00:00:00.000Z");
  task.updatedAt = new Date("2026-10-03T12:00:00.000Z");
  return Object.assign(task, overrides);
}

export function makeComments(count: number, chars: number, char: string): TaskCommentEntry[] {
  // Newest comment is stored first so ordering is exercised.
  return Array.from({ length: count }, (_, index) => ({
    id: `c-${String(index).padStart(2, "0")}`,
    body: `${index}:`.padEnd(chars, char),
    createdAt: new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString(),
  })).reverse();
}

export function buildBigCard(char: string): Task {
  return buildFixedCard({
    id: "task-big",
    comments: makeComments(50, 5000, char),
    objective: char.repeat(10000),
    verificationReport: char.repeat(20000),
  });
}
