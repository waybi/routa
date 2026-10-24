// @vitest-environment node
/**
 * Card 6d8365ca, C2 S3/S4 and C3 S6 at the agent-process layer: the end of a
 * lane step comes from a real AcpProcess (prompt answered after Routa stopped
 * waiting, or the process exiting on its own) and travels through the session
 * store and EventBus to the orchestrator. Pusher 435fbeed (2026-10-23) exited
 * with code 0 and its lane record stayed "running".
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

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => {
    throw new Error("no RoutaSystem in this test");
  },
}));

import { AcpProcess } from "../../acp/acp-process";
import { getHttpSessionStore, type SessionUpdateNotification } from "../../acp/http-session-store";
import { EventBus } from "../../events/event-bus";
import { createKanbanBoard } from "../../models/kanban";
import { createTask } from "../../models/task";
import { InMemoryKanbanBoardStore } from "../../store/kanban-board-store";
import { InMemoryTaskStore } from "../../store/task-store";
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
  pid: number | undefined = 4343;
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
  /** The process ends without Routa asking for it. */
  exitOnItsOwn(code: number | null, signal: string | null = null): void {
    this.exitCode = code;
    this.emit("exit", code, signal);
  }
}

let tmpHome: string;
let originalHome: string | undefined;

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "routa-lane-end-process-"));
  originalHome = process.env.HOME;
  process.env.HOME = tmpHome;
  spawnMock.mockReset();
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  await fs.rm(tmpHome, { recursive: true, force: true });
});

let counter = 0;

async function setup(options: { tracked?: boolean } = {}) {
  counter += 1;
  const prefix = `lane-end-${counter}`;
  const eventBus = new EventBus();
  const store = getHttpSessionStore();
  store.setEventBus(eventBus);
  const boardStore = new InMemoryKanbanBoardStore();
  const taskStore = new InMemoryTaskStore();
  const killSession = vi.fn(async () => undefined);
  const board = createKanbanBoard({
    id: `${prefix}-board`,
    workspaceId: "default",
    name: "Board",
    isDefault: true,
    columns: [
      { id: "review", name: "Review", stage: "review", position: 0 },
      {
        id: "done",
        name: "Done",
        stage: "done",
        position: 1,
        automation: {
          enabled: true,
          transitionType: "entry",
          steps: [
            { id: "pusher", providerId: "dsh", role: "GATE", specialistId: "kanban-main-pusher" },
            { id: "reporter", providerId: "dsh", role: "GATE", specialistId: "kanban-done-reporter" },
          ],
        },
      },
    ],
  });
  await boardStore.save(board);
  const task = createTask({
    id: `${prefix}-task`,
    title: "Done lane step ends in the agent process",
    objective: "Push to main",
    workspaceId: "default",
    boardId: board.id,
    columnId: "done",
  });
  await taskStore.save(task);

  const sessionId = `${prefix}-pusher`;
  const createSession = vi.fn(async (params: { stepIndex: number }) => {
    const id = params.stepIndex === 0 ? sessionId : `${prefix}-reporter`;
    store.upsertSession({ sessionId: id, workspaceId: "default", provider: "dsh", cwd: "/tmp", createdAt: new Date().toISOString() });
    const current = await taskStore.get(task.id);
    current!.triggerSessionId = id;
    upsertTaskLaneSession(current!, { sessionId: id, columnId: "done", stepIndex: params.stepIndex, status: "running" });
    await taskStore.save(current!);
    return id;
  });

  const orchestrator = new KanbanWorkflowOrchestrator(eventBus, boardStore, taskStore, createSession, killSession);
  orchestrator.start();
  await orchestrator.processColumnTransition({
    cardId: task.id,
    cardTitle: task.title,
    boardId: board.id,
    workspaceId: "default",
    fromColumnId: "review",
    toColumnId: "done",
  });
  expect(orchestrator.getAutomationForCard(task.id)).toMatchObject({ sessionId, status: "running" });
  // An untracked run (e.g. started by revive before adoption existed): no automation follows it.
  if (options.tracked === false) {
    (orchestrator as unknown as { activeAutomations: Map<string, unknown> }).activeAutomations.delete(task.id);
  }

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

  const record = async () =>
    (await taskStore.get(task.id))?.laneSessions?.find((entry) => entry.sessionId === sessionId);
  expect((await record())?.status).toBe("running");

  return { eventBus, orchestrator, store, task, sessionId, dsh, proc, record, createSession };
}

describe("C2 / S3: prompt answered with an error after Routa stopped waiting", () => {
  it.each([true, false])("S3 tracked=%s: failed with completedAt and recoveryReason", async (tracked) => {
    const ctx = await setup({ tracked });
    await expect(ctx.proc.sendRequest("session/prompt", { sessionId: "agent-session", prompt: [] }, 20))
      .rejects.toThrow("Timeout waiting for session/prompt");

    ctx.dsh.answer({
      id: ctx.dsh.lastPromptId(),
      error: { code: -32603, message: "Internal error: turn failed: usage_limit_reached trial_rate_limited" },
    });

    await vi.waitFor(async () => expect((await ctx.record())?.status).toBe("failed"));
    const record = await ctx.record();
    expect(record?.completedAt).toEqual(expect.any(String));
    expect(record?.recoveryReason).toBeTruthy();
    ctx.orchestrator.stop();
  });
});

describe("C2 / S4: the agent process exits on its own with a non-zero code", () => {
  it.each([true, false])("S4 tracked=%s: failed with completedAt and recoveryReason", async (tracked) => {
    const ctx = await setup({ tracked });

    ctx.dsh.exitOnItsOwn(1);

    await vi.waitFor(async () => expect((await ctx.record())?.status).toBe("failed"));
    const record = await ctx.record();
    expect(record?.completedAt).toEqual(expect.any(String));
    expect(record?.recoveryReason).toBeTruthy();
    ctx.orchestrator.stop();
  });
});

describe("C3 / S6: the agent process exits with code 0", () => {
  it.each([
    { tracked: true, turnEnded: true },
    { tracked: false, turnEnded: true },
    { tracked: true, turnEnded: false },
    { tracked: false, turnEnded: false },
  ])("tracked=$tracked, turn_complete(end_turn) already in the session history=$turnEnded", async ({ tracked, turnEnded }) => {
    const ctx = await setup({ tracked });
    if (turnEnded) {
      // The turn end reached the session store but not the lane record
      // (e.g. it arrived before the record was written).
      ctx.store.pushNotificationToHistory(ctx.sessionId, {
        sessionId: ctx.sessionId,
        update: { sessionUpdate: "turn_complete", stopReason: "end_turn" },
      });
    }

    ctx.dsh.exitOnItsOwn(0);

    await vi.waitFor(async () => expect((await ctx.record())?.status).not.toBe("running"));
    const record = await ctx.record();
    expect(record?.completedAt).toEqual(expect.any(String));
    if (turnEnded) {
      expect(record?.status).toBe("completed");
      expect(record?.recoveryReason).toBeUndefined();
    } else {
      expect(record?.status).toBe("failed");
      expect(record?.recoveryReason).toBeTruthy();
    }
    ctx.orchestrator.stop();
  });
});
