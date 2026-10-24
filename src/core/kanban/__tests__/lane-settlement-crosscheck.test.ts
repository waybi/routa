// @vitest-environment node
/**
 * Card 6d8365ca, F3: exhaustive cross-check of how a lane record ends.
 * Every combination of execution path × how the session ended × record
 * already ended or not × card COMPLETED or not runs through the real code and
 * is judged against an expectation table written from the card's acceptance
 * criteria (not from the old behaviour):
 *   - a step that ended with end_turn is completed; a cancelled turn is
 *     failed + turn_cancelled; an error or an exit inside the turn is failed
 *     with a recovery reason; an inactivity timeout is timed_out;
 *   - user-ended (S8) and teardown (S9) sessions are completed or
 *     transitioned, never failed;
 *   - a code-0 exit is completed only after a turn that ended with end_turn;
 *   - the sweep keeps the restart rules when the history has no end;
 *   - a record that already ended is never rewritten by a skip path or the
 *     sweep; skip paths start and kill nothing.
 * CROSSCHECK_PLANT=1 plants one wrong expectation (S9 + agent_failed on a
 * COMPLETED card written as "failed") to prove the check reports it.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/core/acp/session-prompt", () => ({ dispatchSessionPrompt: vi.fn() }));

import { getHttpSessionStore } from "../../acp/http-session-store";
import { AgentEventType, type AgentEvent } from "../../events/event-bus";
import { createKanbanBoard } from "../../models/kanban";
import { createTask, TaskStatus, type Task, type TaskLaneSession } from "../../models/task";
import { createWorkspace } from "../../models/workspace";
import { createInMemorySystem } from "../../routa-system";
import { endStaleRunningLaneSessions } from "../restart-recovery";
import { upsertTaskLaneSession } from "../task-lane-history";
import { KanbanWorkflowOrchestrator } from "../workflow-orchestrator";

const PATHS = ["tracked", "S8", "S9", "S10", "S11", "exit0", "sweep-current", "sweep-earlier"] as const;
const KINDS = ["end_turn", "cancelled", "agent_failed", "late_error", "exit_nonzero", "timeout", "none"] as const;
type PathName = typeof PATHS[number];
type Kind = typeof KINDS[number];

const T_END = "2026-10-23T11:38:12.345Z";
const T_OLD = "2026-01-01T00:00:00.000Z";

type Expected =
  | { kind: "unchanged" }
  | { kind: "running" }
  | { kind: "ended"; status: TaskLaneSession["status"]; reason?: string | "any"; noReason?: boolean };

const FAILURE_KINDS: Kind[] = ["cancelled", "agent_failed", "late_error", "exit_nonzero", "timeout"];

/** Expected record by the event's meaning (AC1, AC2, AC4 S10/S11). */
function byEvent(kind: Kind): Expected {
  switch (kind) {
    case "end_turn": return { kind: "ended", status: "completed", noReason: true };
    case "cancelled": return { kind: "ended", status: "failed", reason: "turn_cancelled" };
    case "agent_failed":
    case "late_error":
    case "exit_nonzero": return { kind: "ended", status: "failed", reason: "any" };
    case "timeout": return { kind: "ended", status: "timed_out" };
    case "none": return { kind: "running" };
  }
}

/** Expected record from the history only (AC6): undefined when the history has no end. */
function byHistory(kind: Kind): Expected | undefined {
  if (kind === "timeout" || kind === "none") return undefined;
  return byEvent(kind);
}

function expectation(path: PathName, kind: Kind, alreadyEnded: boolean, cardCompleted: boolean): Expected {
  if (process.env.CROSSCHECK_PLANT === "1" && path === "S9" && kind === "agent_failed" && cardCompleted && !alreadyEnded) {
    return { kind: "ended", status: "failed", reason: "any" };
  }
  // A record that already ended is final on every path.
  if (alreadyEnded) return { kind: "unchanged" };
  switch (path) {
    case "tracked":
    case "S10":
    case "S11":
      return byEvent(kind);
    case "S9":
      // Teardown only covers failures on a COMPLETED card; otherwise it is the step's own end.
      return cardCompleted && FAILURE_KINDS.includes(kind)
        ? { kind: "ended", status: "transitioned", noReason: true }
        : byEvent(kind);
    case "S8":
      if (kind === "none") return { kind: "running" };
      return kind === "end_turn"
        ? { kind: "ended", status: "completed", noReason: true }
        : { kind: "ended", status: "transitioned", noReason: true };
    case "exit0":
      return kind === "end_turn"
        ? { kind: "ended", status: "completed", noReason: true }
        : { kind: "ended", status: "failed", reason: "any" };
    case "sweep-current":
      return byHistory(kind) ?? { kind: "ended", status: "timed_out", reason: "restart_interrupted" };
    case "sweep-earlier":
      return byHistory(kind) ?? { kind: "ended", status: "transitioned", noReason: true };
  }
}

type Entry = { update: Record<string, unknown>; createdAt?: string };

function historyFor(kind: Kind): Entry[] {
  const at = (update: Record<string, unknown>): Entry => ({ update, createdAt: T_END });
  const start = { update: { sessionUpdate: "user_message" }, createdAt: "2026-10-23T11:30:00.000Z" };
  switch (kind) {
    case "end_turn": return [start, at({ sessionUpdate: "turn_complete", stopReason: "end_turn" })];
    case "cancelled": return [start, at({ sessionUpdate: "turn_complete", stopReason: "cancelled" })];
    case "agent_failed": return [start, at({ sessionUpdate: "error", error: { code: "agent_error", message: "turn failed" } })];
    case "late_error": return [start, at({ sessionUpdate: "error", error: { code: "prompt_failed_after_timeout", message: "usage_limit_reached" } })];
    case "exit_nonzero": return [start, at({ sessionUpdate: "error", error: { code: "process_exited", message: "process exited unexpectedly (code=1, signal=null)" } })];
    case "timeout": return [start];
    case "none": return [start, { update: { sessionUpdate: "tool_call", title: "npm test" } }];
  }
}

function eventFor(kind: Kind, sessionId: string): AgentEvent | undefined {
  const ev = (type: AgentEventType, data: Record<string, unknown>): AgentEvent => ({
    type, agentId: sessionId, workspaceId: "ws-x", data: { sessionId, ...data }, timestamp: new Date(),
  });
  switch (kind) {
    case "end_turn": return ev(AgentEventType.AGENT_COMPLETED, { success: true, stopReason: "end_turn" });
    case "cancelled": return ev(AgentEventType.AGENT_COMPLETED, { success: false, stopReason: "cancelled" });
    case "agent_failed": return ev(AgentEventType.AGENT_FAILED, { success: false, error: "turn failed" });
    case "late_error": return ev(AgentEventType.AGENT_FAILED, { success: false, error: "DeepSeek Harness turn ended with an error after Routa stopped waiting for it: usage_limit_reached" });
    case "exit_nonzero": return ev(AgentEventType.AGENT_FAILED, { success: false, error: "DeepSeek Harness process exited unexpectedly (code=1, signal=null)" });
    case "timeout": return ev(AgentEventType.AGENT_TIMEOUT, { success: false, error: "No ACP activity for 20 minutes." });
    case "none": return undefined;
  }
}

let counter = 0;

async function runCase(path: PathName, kind: Kind, alreadyEnded: boolean, cardCompleted: boolean) {
  counter += 1;
  const id = `xc-${counter}`;
  const system = createInMemorySystem();
  await system.workspaceStore.save(createWorkspace({ id: "ws-x", title: "X" }));
  await system.kanbanBoardStore.save(createKanbanBoard({
    id: "board-x",
    workspaceId: "ws-x",
    name: "X",
    isDefault: true,
    columns: [
      { id: "dv", name: "Dev", position: 0, stage: "dev" },
      {
        id: "rv",
        name: "Review",
        position: 1,
        stage: "review",
        automation: { enabled: true, transitionType: "entry", autoAdvanceOnSuccess: false, steps: [{ id: "guard", providerId: "dsh", role: "GATE", specialistId: "guard" }] },
      },
    ],
  }));
  await system.taskStore.save(createTask({
    id, title: id, objective: id, workspaceId: "ws-x", boardId: "board-x", columnId: "rv",
    status: cardCompleted ? TaskStatus.COMPLETED : TaskStatus.IN_PROGRESS,
  }));
  const store = getHttpSessionStore();
  const starts = vi.fn();
  const kills = vi.fn(async () => undefined);
  const tracked = `${id}-tracked`;
  const createSession = async () => {
    starts();
    const task = (await system.taskStore.get(id))!;
    task.triggerSessionId = tracked;
    upsertTaskLaneSession(task, { sessionId: tracked, columnId: "rv", stepIndex: 0, status: "running" });
    await system.taskStore.save(task);
    return tracked;
  };
  const orchestrator = new KanbanWorkflowOrchestrator(system.eventBus, system.kanbanBoardStore, system.taskStore, createSession, kills);
  const internals = orchestrator as unknown as {
    cardEndedSessionIds: Set<string>;
    teardownSessionIds: Set<string>;
    handleAgentCompletion(event: AgentEvent): Promise<void>;
  };

  const sweep = path === "sweep-current" || path === "sweep-earlier";
  let target = tracked;
  if (!sweep) {
    await orchestrator.processColumnTransition({ cardId: id, cardTitle: id, boardId: "board-x", workspaceId: "ws-x", fromColumnId: "dv", toColumnId: "rv" });
  }
  if (path === "S11" || sweep) {
    target = `${id}-other`;
    const task = (await system.taskStore.get(id))!;
    upsertTaskLaneSession(task, { sessionId: target, columnId: path === "sweep-earlier" ? "dv" : "rv", stepIndex: 0, status: "running" });
    await system.taskStore.save(task);
  }
  if (alreadyEnded) {
    const task = (await system.taskStore.get(id))!;
    upsertTaskLaneSession(task, { sessionId: target, status: "failed", completedAt: T_OLD, recoveryReason: "agent_failed" });
    await system.taskStore.save(task);
  }
  const before = (await system.taskStore.get(id))!.laneSessions!.find((entry) => entry.sessionId === target)!;
  const beforeCopy = JSON.parse(JSON.stringify(before)) as TaskLaneSession;

  let history = historyFor(kind);
  let event = eventFor(kind, target);
  if (path === "exit0") {
    history = [...history, { update: { sessionUpdate: "error", error: { code: "process_exited", message: "process exited unexpectedly (code=0, signal=null)" } } }];
    event = { type: AgentEventType.AGENT_FAILED, agentId: target, workspaceId: "ws-x", data: { sessionId: target, success: false, error: "DeepSeek Harness process exited unexpectedly (code=0, signal=null)" }, timestamp: new Date() };
  }

  const startsBefore = starts.mock.calls.length;
  if (sweep) {
    await endStaleRunningLaneSessions(system, {
      sessionStore: { getSession: () => undefined } as never,
      processManager: { hasActiveSession: () => false } as never,
      readSessionEndHistory: async (sessionId: string) => (sessionId === target ? history : []),
    });
  } else {
    store.upsertSession({ sessionId: target, cwd: "/tmp", workspaceId: "ws-x", provider: "dsh", createdAt: new Date().toISOString() });
    for (const entry of history) store.pushNotificationToHistory(target, { sessionId: target, update: entry.update });
    if (path === "S8") internals.cardEndedSessionIds.add(target);
    if (path === "S9") internals.teardownSessionIds.add(target);
    if (path === "S10") orchestrator.getAutomationForCard(id)!.status = "completed";
    if (event) await internals.handleAgentCompletion(event);
  }

  const after = (await system.taskStore.get(id))!.laneSessions!.find((entry) => entry.sessionId === target)!;
  const skipPath = path === "S8" || path === "S9" || path === "S10" || path === "S11" || sweep;
  const sideEffects = skipPath && (path !== "S9" || (cardCompleted && FAILURE_KINDS.includes(kind)))
    ? { starts: starts.mock.calls.length - startsBefore, kills: kills.mock.calls.length }
    : undefined;
  return { beforeCopy, after, sideEffects, sweep };
}

function judge(expected: Expected, run: Awaited<ReturnType<typeof runCase>>): string | undefined {
  const { after, beforeCopy } = run;
  if (run.sideEffects && (run.sideEffects.starts !== 0 || run.sideEffects.kills !== 0)) {
    return `side effects ${JSON.stringify(run.sideEffects)}`;
  }
  if (expected.kind === "unchanged") {
    // The ended state (status, end time, reason) stays; activity bookkeeping may refresh.
    const state = (entry: TaskLaneSession) => JSON.stringify([entry.status, entry.completedAt, entry.recoveryReason]);
    return state(after) === state(beforeCopy) ? undefined : `changed ${state(beforeCopy)} -> ${state(after)}`;
  }

  if (expected.kind === "running") return after.status === "running" ? undefined : `status ${after.status}`;
  if (after.status !== expected.status) return `status ${after.status}/${after.recoveryReason}, expected ${expected.status}`;
  if (!after.completedAt) return "no completedAt";
  if (expected.reason === "any" && !after.recoveryReason) return "no recoveryReason";
  if (expected.reason && expected.reason !== "any" && after.recoveryReason !== expected.reason) return `reason ${after.recoveryReason}, expected ${expected.reason}`;
  if (expected.noReason && after.recoveryReason) return `unexpected reason ${after.recoveryReason}`;
  if (run.sweep && (expected.status === "completed" || expected.status === "failed") && after.completedAt !== T_END) {
    return `completedAt ${after.completedAt}, expected the session end ${T_END}`;
  }
  return undefined;
}

describe("F3: every path × outcome × record state × card state", () => {
  it("matches the expectation table in every cell", async () => {
    const mismatches: string[] = [];
    let total = 0;
    for (const path of PATHS) {
      for (const kind of KINDS) {
        for (const alreadyEnded of [false, true]) {
          for (const cardCompleted of [false, true]) {
            total += 1;
            const run = await runCase(path, kind, alreadyEnded, cardCompleted);
            const problem = judge(expectation(path, kind, alreadyEnded, cardCompleted), run);
            if (problem) mismatches.push(`${path} × ${kind} × ended=${alreadyEnded} × completedCard=${cardCompleted}: ${problem}`);
          }
        }
      }
    }
    console.log(`[F3 cross-check] combinations=${total} mismatches=${mismatches.length}`);
    for (const line of mismatches) console.log(`[F3 cross-check] MISMATCH ${line}`);
    expect(total).toBe(PATHS.length * KINDS.length * 4);
    expect(mismatches).toEqual([]);
  }, 120_000);
});
