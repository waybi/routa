// @vitest-environment node
/**
 * Card 75f3b360 criterion 6: Routa stops waiting for session/prompt after
 * 5 minutes, but dsh keeps working and answers later. That late answer must
 * still end the lane step and free its board slot. Before the fix, a late
 * error answer was logged as "Unhandled message" (48 times in the
 * 2026-10-23 pm2 log) and the lane stayed running forever.
 */
import { EventEmitter } from "node:events";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IProcessHandle, WritableStreamLike } from "@/core/platform/interfaces";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("@/core/platform", () => ({
  getServerBridge: () => ({
    process: { isAvailable: () => true, spawn: spawnMock, execSync: vi.fn() },
  }),
}));

// Keep the store on this test's EventBus instead of a full RoutaSystem.
vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => {
    throw new Error("no RoutaSystem in this test");
  },
}));

import { AcpProcess } from "../../acp/acp-process";
import { getHttpSessionStore, type SessionUpdateNotification } from "../../acp/http-session-store";
import { AgentEventType, EventBus } from "../../events/event-bus";
import { createKanbanBoard } from "../../models/kanban";
import { createTask } from "../../models/task";
import { InMemoryKanbanBoardStore } from "../../store/kanban-board-store";
import { InMemoryTaskStore } from "../../store/task-store";
import { KanbanSessionQueue } from "../kanban-session-queue";
import { upsertTaskLaneSession } from "../task-lane-history";
import { KanbanWorkflowOrchestrator } from "../workflow-orchestrator";

class FakeWritable implements WritableStreamLike {
  writable = true;
  writes: string[] = [];
  write(data: string | Buffer): boolean {
    this.writes.push(String(data));
    return true;
  }
}

class FakeDsh extends EventEmitter implements IProcessHandle {
  pid: number | undefined = 4242;
  stdin = new FakeWritable();
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  exitCode: number | null = null;
  kill(): void {
    this.exitCode = 0;
    this.emit("exit", 0, null);
  }
  answer(message: Record<string, unknown>): void {
    this.stdout.emit("data", Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n"));
  }
  lastPromptId(): number {
    return this.stdin.writes.map((w) => JSON.parse(w)).filter((m) => m.method === "session/prompt").at(-1).id;
  }
}

let tmpHome: string;
let originalHome: string | undefined;

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "routa-late-turn-"));
  originalHome = process.env.HOME;
  process.env.HOME = tmpHome;
  spawnMock.mockReset();
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  await fs.rm(tmpHome, { recursive: true, force: true });
});

async function setup(prefix: string) {
  const eventBus = new EventBus();
  const store = getHttpSessionStore();
  store.setEventBus(eventBus);
  const boardStore = new InMemoryKanbanBoardStore();
  const taskStore = new InMemoryTaskStore();
  const killSession = vi.fn(async () => undefined);
  const queue = new KanbanSessionQueue(eventBus, taskStore, async () => 1);
  queue.start();

  const board = createKanbanBoard({
    id: `${prefix}-board`,
    workspaceId: "default",
    name: "Main Board",
    isDefault: true,
    columns: [
      { id: "todo", name: "Todo", stage: "todo", position: 0 },
      {
        id: "done",
        name: "Done",
        stage: "done",
        position: 1,
        automation: { enabled: true, providerId: "dsh", role: "GATE", transitionType: "entry" },
      },
    ],
  });
  await boardStore.save(board);
  const task = createTask({
    id: `${prefix}-task`,
    title: "Main Pusher runs the full test suite",
    objective: "Push to main",
    workspaceId: "default",
    boardId: board.id,
    columnId: "done",
  });
  await taskStore.save(task);

  const sessionId = `${prefix}-session`;
  const createSession = vi.fn(async () => {
    const result = await queue.enqueue({
      cardId: task.id,
      cardTitle: task.title,
      boardId: board.id,
      workspaceId: "default",
      columnId: "done",
      start: async () => {
        store.upsertSession({
          sessionId,
          workspaceId: "default",
          provider: "dsh",
          cwd: "/tmp",
          createdAt: new Date().toISOString(),
        });
        const current = await taskStore.get(task.id);
        current!.triggerSessionId = sessionId;
        upsertTaskLaneSession(current!, { sessionId, columnId: "done", status: "running" });
        await taskStore.save(current!);
        return { sessionId };
      },
    });
    return result.sessionId ?? null;
  });

  const orchestrator = new KanbanWorkflowOrchestrator(eventBus, boardStore, taskStore, createSession, killSession);
  orchestrator.start();
  await orchestrator.processColumnTransition({
    cardId: task.id,
    cardTitle: task.title,
    boardId: board.id,
    workspaceId: "default",
    fromColumnId: "todo",
    toColumnId: "done",
  });
  expect(orchestrator.getAutomationForCard(task.id)).toMatchObject({ sessionId, status: "running" });
  expect((await queue.getBoardSnapshot(board.id)).runningCount).toBe(1);

  // A real AcpProcess wired to the store the way session-prompt.ts does it.
  const dsh = new FakeDsh();
  spawnMock.mockReturnValue(dsh);
  const proc = new AcpProcess(
    { command: "dsh", args: [], cwd: "/tmp", displayName: "DeepSeek Harness" },
    (msg) => {
      if (msg.method !== "session/update" || !msg.params) return;
      store.pushNotification({ ...(msg.params as Record<string, unknown>), sessionId } as SessionUpdateNotification);
    },
  );
  await proc.start();
  (proc as unknown as { _sessionId: string })._sessionId = "agent-session";

  // Routa gives up on the prompt; the route keeps the session "alive".
  await expect(proc.sendRequest("session/prompt", { sessionId: "agent-session", prompt: [] }, 20))
    .rejects.toThrow("Timeout waiting for session/prompt");

  const laneStatus = async () =>
    (await taskStore.get(task.id))?.laneSessions?.find((entry) => entry.sessionId === sessionId)?.status;
  expect(await laneStatus()).toBe("running");

  return { eventBus, orchestrator, queue, board, task, sessionId, dsh, killSession, laneStatus };
}

describe("a turn end that arrives after Routa stopped waiting for session/prompt", () => {
  it("marks the lane failed and frees the board slot when the late answer is an error", async () => {
    const ctx = await setup("late-error");

    ctx.dsh.answer({
      id: ctx.dsh.lastPromptId(),
      error: { code: -32603, message: "Internal error: turn failed: usage_limit_reached trial_rate_limited" },
    });

    await vi.waitFor(async () => {
      expect(await ctx.laneStatus()).toBe("failed");
      expect((await ctx.queue.getBoardSnapshot(ctx.board.id)).runningCount).toBe(0);
    });
    expect(ctx.orchestrator.getAutomationForCard(ctx.task.id)?.status).toBe("failed");
    expect(ctx.killSession).toHaveBeenCalledWith(ctx.sessionId);
    ctx.orchestrator.stop();
    ctx.queue.stop();
  });

  it("marks the lane completed and frees the board slot when the late answer is a normal end", async () => {
    const ctx = await setup("late-success");
    const completed = vi.fn();
    ctx.eventBus.on("late-success-listener", (event) => {
      if (event.type === AgentEventType.AGENT_COMPLETED) completed(event.data?.sessionId);
    });

    ctx.dsh.answer({ id: ctx.dsh.lastPromptId(), result: { stopReason: "end_turn" } });

    await vi.waitFor(async () => {
      expect(await ctx.laneStatus()).toBe("completed");
      expect((await ctx.queue.getBoardSnapshot(ctx.board.id)).runningCount).toBe(0);
    });
    expect(completed).toHaveBeenCalledWith(ctx.sessionId);
    ctx.orchestrator.stop();
    ctx.queue.stop();
  });
});
