// @vitest-environment node
/**
 * End-to-end lane model resolution: every way Routa starts a lane agent goes
 * through the real orchestrator, the real agent trigger and the real
 * POST /api/acp session/new. Only the agent process is faked, so each test
 * asserts the DSH_ACP_MODEL the lane agent would really be started with.
 *
 * Order under test: card > column step > specialist model
 *   > global tier setting (~/.routa/kanban-model-tiers.json) > code tier table > acp default.
 * Reasoning effort: card > column step > global tier effort (dsh only) > acp default.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { processManager, systemRef } = vi.hoisted(() => ({
  processManager: {
    createSession: vi.fn(),
    getProcess: vi.fn((): unknown => undefined),
    hasActiveSession: vi.fn(() => false),
    getConfigOptions: vi.fn((): unknown[] => []),
    setConfigOption: vi.fn(async (_sessionId: string, _configId: string, _value: string): Promise<unknown[]> => []),
    killSession: vi.fn(),
  },
  systemRef: { current: undefined as unknown },
}));

vi.mock("@/core/acp/processer", () => ({ getAcpProcessManager: () => processManager }));
// Never open the real routa.db: revive hydrates the session store first.
vi.mock("@/core/acp/http-session-store", async () => {
  const actual = await vi.importActual<typeof import("@/core/acp/http-session-store")>("@/core/acp/http-session-store");
  const store = actual.getHttpSessionStore();
  store.hydrateFromDb = async () => undefined;
  return { ...actual, getHttpSessionStore: () => store };
});
vi.mock("@/core/acp/session-prompt", () => ({ dispatchSessionPrompt: vi.fn(async () => undefined) }));
vi.mock("@/app/api/acp/acp-session-history", () => ({
  getSessionWriteBuffer: () => ({ add: vi.fn(), replace: vi.fn(), flush: vi.fn(async () => undefined) }),
}));
vi.mock("@/core/acp/session-db-persister", async () => ({
  ...(await vi.importActual<typeof import("@/core/acp/session-db-persister")>("@/core/acp/session-db-persister")),
  persistSessionToDb: vi.fn(async () => undefined),
  updateSessionExecutionBindingInDb: vi.fn(async () => undefined),
  loadSessionFromDb: vi.fn(async () => null),
  loadSessionFromLocalStorage: vi.fn(async () => null),
}));
vi.mock("@/core/routa-system", async () => {
  const actual = await vi.importActual<typeof import("@/core/routa-system")>("@/core/routa-system");
  return { ...actual, getRoutaSystem: () => systemRef.current };
});
vi.mock("@/core/orchestration/specialist-prompts", async () => {
  const actual = await vi.importActual<typeof import("@/core/orchestration/specialist-prompts")>(
    "@/core/orchestration/specialist-prompts",
  );
  const { ModelTier, AgentRole } = await vi.importActual<typeof import("@/core/models/agent")>("@/core/models/agent");
  const fake = (id: string, tier: string, model?: string) => ({
    id, name: id, description: id, role: AgentRole.CRAFTER, defaultModelTier: tier,
    systemPrompt: `You are ${id}.`, roleReminder: "", ...(model ? { model } : {}),
  });
  const fakes: Record<string, ReturnType<typeof fake>> = {
    "spec-fast": fake("spec-fast", ModelTier.FAST),
    "spec-balanced": fake("spec-balanced", ModelTier.BALANCED),
    "spec-smart": fake("spec-smart", ModelTier.SMART),
    "spec-own-model": fake("spec-own-model", ModelTier.SMART, "claude-haiku-5-5"),
  };
  return {
    ...actual,
    getSpecialistById: (id: string, locale?: string) => fakes[id] ?? actual.getSpecialistById(id, locale),
  };
});

import { POST as acpPost } from "@/app/api/acp/route";
import { PATCH as taskPatch } from "@/app/api/tasks/[taskId]/route";
import { POST as revivePost } from "@/app/api/kanban/boards/[boardId]/revive/route";
import { createInMemorySystem, type RoutaSystem } from "../../routa-system";
import { AgentEventType } from "../../events/event-bus";
import { createCodebase } from "../../models/codebase";
import { createKanbanBoard, type KanbanAutomationStep } from "../../models/kanban";
import { createTask, TaskStatus, type Task } from "../../models/task";
import {
  writeKanbanModelTierOverrides,
  writeKanbanModelTierSettings,
  type KanbanModelTierOverrides,
} from "../kanban-model-tiers";
import {
  getWorkflowOrchestrator,
  processKanbanColumnTransition,
  resetWorkflowOrchestrator,
  startWorkflowOrchestrator,
} from "../workflow-orchestrator-singleton";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "routa-lane-model-tiers-"));
const tiersFile = path.join(tmpDir, "kanban-model-tiers.json");
const GLOBAL: Required<KanbanModelTierOverrides> = {
  fast: "gpt-5.6-luna",
  balanced: "gpt-6-astra",
  smart: "claude-sonnet-5-5",
};
const CODE_DEFAULT = "claude-opus-5-5";

let sessionCounter = 0;

function startedModels(): Array<string | undefined> {
  return processManager.createSession.mock.calls.map((call) => (call[6] as { DSH_ACP_MODEL?: string } | undefined)?.DSH_ACP_MODEL);
}

function setGlobal(overrides: KanbanModelTierOverrides) {
  writeKanbanModelTierOverrides(overrides);
}

async function setup(steps: KanbanAutomationStep[], card: Partial<Task> = {}) {
  const system = createInMemorySystem();
  systemRef.current = system;
  const board = createKanbanBoard({
    id: "board-tiers",
    workspaceId: "default",
    name: "Board",
    isDefault: true,
    columns: [
      { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
      {
        id: "todo",
        name: "Todo",
        position: 1,
        stage: "todo",
        automation: { enabled: true, transitionType: "entry", autoAdvanceOnSuccess: false, steps },
      },
      { id: "dev", name: "Dev", position: 2, stage: "dev" },
    ],
  });
  await system.kanbanBoardStore.save(board);
  await system.codebaseStore.add(createCodebase({ id: "cb", workspaceId: "default", repoPath: tmpDir, isDefault: true }));
  const task = createTask({
    id: "card-tiers",
    title: "Tier card",
    objective: "Tier card",
    workspaceId: "default",
    boardId: board.id,
    columnId: "todo",
    status: TaskStatus.PENDING,
    ...card,
  });
  await system.taskStore.save(task);
  startWorkflowOrchestrator(system);
  return { system, board, task };
}

async function enterTodo(system: RoutaSystem) {
  const before = processManager.createSession.mock.calls.length;
  await processKanbanColumnTransition(system, {
    cardId: "card-tiers",
    cardTitle: "Tier card",
    boardId: "board-tiers",
    workspaceId: "default",
    fromColumnId: "backlog",
    toColumnId: "todo",
  });
  await vi.waitFor(() => expect(processManager.createSession.mock.calls.length).toBeGreaterThan(before));
  return waitForRunningSession(system);
}

/** The Routa session id the orchestrator is tracking for the card's lane run. */
async function waitForRunningSession(system: RoutaSystem): Promise<string> {
  let sessionId: string | undefined;
  await vi.waitFor(async () => {
    const automation = getWorkflowOrchestrator(system).getAutomationForCard("card-tiers");
    const task = await system.taskStore.get("card-tiers");
    expect(automation?.sessionId).toBeTruthy();
    expect(task?.triggerSessionId).toBe(automation?.sessionId);
    sessionId = automation?.sessionId;
  });
  return sessionId!;
}

const step = (specialistId: string | undefined, extra: Partial<KanbanAutomationStep> = {}): KanbanAutomationStep => ({
  id: `step-${specialistId ?? "none"}-${Math.random().toString(36).slice(2, 6)}`,
  providerId: "dsh",
  role: "CRAFTER",
  ...(specialistId ? { specialistId } : {}),
  ...extra,
});

function emitDone(system: RoutaSystem, sessionId: string, success = true) {
  system.eventBus.emit({
    type: success ? AgentEventType.AGENT_COMPLETED : AgentEventType.AGENT_FAILED,
    agentId: sessionId,
    workspaceId: "default",
    data: { sessionId, success, ...(success ? {} : { error: "step failed" }) },
    timestamp: new Date(),
  });
}

describe("lane agent model: global tier setting on every start path", () => {
  beforeEach(() => {
    process.env.ROUTA_KANBAN_MODEL_TIERS_FILE = tiersFile;
    fs.rmSync(tiersFile, { force: true });
    resetWorkflowOrchestrator();
    processManager.createSession.mockReset();
    processManager.createSession.mockImplementation(async () => `acp-${++sessionCounter}`);
    processManager.hasActiveSession.mockReturnValue(false);
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/acp")) {
        return acpPost(new NextRequest(url, init as ConstructorParameters<typeof NextRequest>[1]));
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
  });

  afterEach(() => {
    resetWorkflowOrchestrator();
    vi.unstubAllGlobals();
    delete process.env.ROUTA_KANBAN_MODEL_TIERS_FILE;
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("resolution order (column transition path)", () => {
    it("card model wins over the step, the specialist and the global setting", async () => {
      setGlobal(GLOBAL);
      const { system } = await setup(
        [step("spec-own-model", { model: "gpt-6.1-sol" })],
        { assignedModel: "muse-spark-1.3" },
      );
      await enterTodo(system);
      expect(startedModels()).toEqual(["muse-spark-1.3"]);
    });

    it("column step model wins when the card has none", async () => {
      setGlobal(GLOBAL);
      const { system } = await setup([step("spec-own-model", { model: "gpt-6.1-sol" })]);
      await enterTodo(system);
      expect(startedModels()).toEqual(["gpt-6.1-sol"]);
    });

    it("specialist model wins over the global setting when card and step are blank", async () => {
      setGlobal(GLOBAL);
      const { system } = await setup([step("spec-own-model")]);
      await enterTodo(system);
      expect(startedModels()).toEqual(["claude-haiku-5-5"]);
    });

    it.each([
      ["spec-fast", GLOBAL.fast],
      ["spec-balanced", GLOBAL.balanced],
      ["spec-smart", GLOBAL.smart],
    ])("global setting is used for %s when card, step and specialist are blank", async (specialistId, expected) => {
      setGlobal(GLOBAL);
      const { system } = await setup([step(specialistId)]);
      await enterTodo(system);
      expect(startedModels()).toEqual([expected]);
    });

    it("a tier the global setting leaves blank falls back to the code tier table", async () => {
      setGlobal({ smart: GLOBAL.smart });
      const { system } = await setup([step("spec-balanced")]);
      await enterTodo(system);
      expect(startedModels()).toEqual([CODE_DEFAULT]);
    });

    it("no global setting at all uses the code tier table", async () => {
      const { system } = await setup([step("spec-smart")]);
      await enterTodo(system);
      expect(startedModels()).toEqual([CODE_DEFAULT]);
    });

    it("a step without a specialist tier gets no DSH_ACP_MODEL (acp profile default)", async () => {
      setGlobal(GLOBAL);
      const { system } = await setup([step(undefined)]);
      await enterTodo(system);
      expect(startedModels()).toEqual([undefined]);
    });
  });

  it("next step in the lane starts with the global setting for its tier", async () => {
    setGlobal(GLOBAL);
    const { system } = await setup([step("spec-fast"), step("spec-balanced")]);
    const firstSessionId = await enterTodo(system);
    emitDone(system, firstSessionId);
    await vi.waitFor(() => expect(processManager.createSession).toHaveBeenCalledTimes(2), { timeout: 5000 });
    expect(startedModels()).toEqual([GLOBAL.fast, GLOBAL.balanced]);
  });

  it("PATCH retryTrigger restarts the lane with the global setting", async () => {
    setGlobal(GLOBAL);
    const { system } = await setup([step("spec-smart")]);
    const firstSessionId = await enterTodo(system);
    emitDone(system, firstSessionId, false);
    await vi.waitFor(() => {
      expect(getWorkflowOrchestrator(system).getAutomationForCard("card-tiers")?.status).toBe("failed");
    });
    // Everything started so far ran with the old setting.
    expect(new Set(startedModels())).toEqual(new Set([GLOBAL.smart]));
    const before = processManager.createSession.mock.calls.length;
    setGlobal({ ...GLOBAL, smart: "claude-fable-5-1" });

    const response = await taskPatch(new NextRequest("http://localhost/api/tasks/card-tiers", {
      method: "PATCH",
      body: JSON.stringify({ retryTrigger: true }),
      headers: { "Content-Type": "application/json" },
    }), { params: Promise.resolve({ taskId: "card-tiers" }) });

    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(processManager.createSession.mock.calls.length).toBe(before + 1));
    expect(startedModels().slice(before)).toEqual(["claude-fable-5-1"]);
  });

  it("POST revive starts the lane's next step with the global setting", async () => {
    setGlobal(GLOBAL);
    const { system } = await setup([step("spec-fast"), step("spec-balanced")]);
    // State after a restart: step 1 finished, step 2 never started, no trigger.
    const task = (await system.taskStore.get("card-tiers"))!;
    task.laneSessions = [{
      sessionId: "old-step-1",
      columnId: "todo",
      columnName: "Todo",
      stepIndex: 0,
      stepId: "step-1",
      status: "completed",
      startedAt: new Date(Date.now() - 60_000).toISOString(),
    }] as Task["laneSessions"];
    task.triggerSessionId = undefined;
    await system.taskStore.save(task);

    const response = await revivePost(new NextRequest("http://localhost/api/kanban/boards/board-tiers/revive", {
      method: "POST",
    }), { params: Promise.resolve({ boardId: "board-tiers" }) });

    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(processManager.createSession).toHaveBeenCalledTimes(1));
    expect(startedModels()).toEqual([GLOBAL.balanced]);
  });

  it("POST revive re-enters a lane that never started with the global setting", async () => {
    setGlobal(GLOBAL);
    await setup([step("spec-smart")]);

    const response = await revivePost(new NextRequest("http://localhost/api/kanban/boards/board-tiers/revive", {
      method: "POST",
    }), { params: Promise.resolve({ boardId: "board-tiers" }) });

    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(processManager.createSession).toHaveBeenCalledTimes(1));
    expect(startedModels()).toEqual([GLOBAL.smart]);
  });

  it("POST /api/acp session/new on its own resolves the specialist tier through the global setting", async () => {
    setGlobal(GLOBAL);
    systemRef.current = createInMemorySystem();
    const response = await acpPost(new NextRequest("http://localhost/api/acp", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "session/new",
        params: { provider: "dsh", workspaceId: "default", cwd: tmpDir, specialistId: "spec-fast" },
      }),
    }));
    expect(response.status).toBe(200);
    expect(startedModels()).toEqual([GLOBAL.fast]);
  });

  it("POST /api/acp session/new keeps an explicit model over the global setting", async () => {
    setGlobal(GLOBAL);
    systemRef.current = createInMemorySystem();
    await acpPost(new NextRequest("http://localhost/api/acp", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "session/new",
        params: { provider: "dsh", workspaceId: "default", cwd: tmpDir, specialistId: "spec-fast", model: "gpt-6.1-sol" },
      }),
    }));
    expect(startedModels()).toEqual(["gpt-6.1-sol"]);
  });

  describe("reasoning effort (agent process with config options)", () => {
    const mv = (model: string) => JSON.stringify(["local-7357", model]);
    let current: { model: string; effort: string };
    const options = () => [
      {
        id: "model",
        type: "select",
        currentValue: mv(current.model),
        options: [{ group: "local-7357", name: "Local 7357", options: [
          CODE_DEFAULT, GLOBAL.fast, GLOBAL.balanced, GLOBAL.smart, "gpt-6.1-sol",
        ].map((model) => ({ value: mv(model), name: model })) }],
      },
      {
        id: "reasoning_effort",
        type: "select",
        currentValue: current.effort,
        options: ["", "low", "medium", "high", "xhigh"].map((value) => ({ value, name: value || "default" })),
      },
    ];

    /** [configId, value] pairs in the order the agent received them. */
    const configCalls = () => processManager.setConfigOption.mock.calls.map((call) => [call[1], call[2]] as const);
    const appliedEfforts = () => configCalls().filter(([id]) => id === "reasoning_effort").map(([, value]) => value);

    beforeEach(() => {
      current = { model: CODE_DEFAULT, effort: "high" };
      processManager.getProcess.mockReturnValue({});
      processManager.getConfigOptions.mockImplementation(() => options());
      processManager.setConfigOption.mockReset();
      processManager.setConfigOption.mockImplementation(async (_sessionId: string, configId: string, value: string) => {
        // Mirrors DSH: switching the model resets reasoning_effort.
        if (configId === "model") current = { model: JSON.parse(value)[1], effort: "" };
        else current = { ...current, effort: value };
        return options();
      });
    });

    afterEach(() => {
      processManager.getProcess.mockImplementation(() => undefined);
      processManager.getConfigOptions.mockImplementation(() => []);
    });

    const TIER_SETTINGS = {
      fast: { model: GLOBAL.fast, reasoningEffort: "low" },
      smart: { model: GLOBAL.smart, reasoningEffort: "xhigh" },
    };

    it("card reasoning effort wins over the step and the global tier effort", async () => {
      writeKanbanModelTierSettings(TIER_SETTINGS);
      const { system } = await setup(
        [step("spec-smart", { reasoningEffort: "medium" })],
        { assignedReasoningEffort: "low" },
      );
      await enterTodo(system);
      await vi.waitFor(() => expect(appliedEfforts()).toEqual(["low"]));
    });

    it("column step reasoning effort wins over the global tier effort", async () => {
      writeKanbanModelTierSettings(TIER_SETTINGS);
      const { system } = await setup([step("spec-smart", { reasoningEffort: "medium" })]);
      await enterTodo(system);
      await vi.waitFor(() => expect(appliedEfforts()).toEqual(["medium"]));
    });

    it("global tier effort applies when card and step leave it blank, after the model", async () => {
      writeKanbanModelTierSettings(TIER_SETTINGS);
      const { system } = await setup([step("spec-smart")]);
      await enterTodo(system);
      await vi.waitFor(() => expect(configCalls()).toEqual([
        ["model", mv(GLOBAL.smart)],
        ["reasoning_effort", "xhigh"],
      ]));
    });

    it("global tier effort applies even when the card names the model", async () => {
      writeKanbanModelTierSettings(TIER_SETTINGS);
      const { system } = await setup([step("spec-fast")], { assignedModel: "gpt-6.1-sol" });
      await enterTodo(system);
      await vi.waitFor(() => expect(configCalls()).toEqual([
        ["model", mv("gpt-6.1-sol")],
        ["reasoning_effort", "low"],
      ]));
    });

    it("no global tier effort leaves the acp default (reasoning_effort is never set)", async () => {
      writeKanbanModelTierSettings({ smart: { model: GLOBAL.smart } });
      const { system } = await setup([step("spec-smart")]);
      await enterTodo(system);
      await vi.waitFor(() => expect(configCalls()).toEqual([["model", mv(GLOBAL.smart)]]));
      expect(appliedEfforts()).toEqual([]);
    });

    it("POST /api/acp session/new on its own applies the global tier effort", async () => {
      writeKanbanModelTierSettings(TIER_SETTINGS);
      systemRef.current = createInMemorySystem();
      const response = await acpPost(new NextRequest("http://localhost/api/acp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "session/new",
          params: { provider: "dsh", workspaceId: "default", cwd: tmpDir, specialistId: "spec-fast" },
        }),
      }));
      expect(response.status).toBe(200);
      expect(configCalls()).toEqual([["model", mv(GLOBAL.fast)], ["reasoning_effort", "low"]]);
    });

    it("POST /api/acp session/new keeps an explicit reasoning effort over the global tier effort", async () => {
      writeKanbanModelTierSettings(TIER_SETTINGS);
      systemRef.current = createInMemorySystem();
      await acpPost(new NextRequest("http://localhost/api/acp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 4,
          method: "session/new",
          params: { provider: "dsh", workspaceId: "default", cwd: tmpDir, specialistId: "spec-fast", reasoningEffort: "medium" },
        }),
      }));
      expect(appliedEfforts()).toEqual(["medium"]);
    });

    it("never applies the global tier effort to a provider other than dsh", async () => {
      writeKanbanModelTierSettings(TIER_SETTINGS);
      systemRef.current = createInMemorySystem();
      const response = await acpPost(new NextRequest("http://localhost/api/acp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 5,
          method: "session/new",
          params: { provider: "codex", workspaceId: "default", cwd: tmpDir, specialistId: "spec-fast" },
        }),
      }));
      expect(response.status).toBe(200);
      expect(processManager.createSession).toHaveBeenCalledTimes(1);
      expect(appliedEfforts()).toEqual([]);
    });
  });
});
