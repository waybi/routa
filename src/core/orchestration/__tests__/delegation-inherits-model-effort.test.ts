/**
 * Members a team lead delegates follow the lead's model / reasoning effort on
 * the same provider (card 44581a6c, AC4; contract C2, F2 ④, F3 ①, F4 ③–⑤).
 */
import { ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentRole, ModelTier, createAgent } from "@/core/models/agent";
import { createTask } from "@/core/models/task";
import type { AcpConfigOption } from "@/core/acp/config-options";

const getSessionMock = vi.hoisted(() => vi.fn());
const specialistMock = vi.hoisted(() => vi.fn());

vi.mock("@/core/acp/http-session-store", () => ({
  getHttpSessionStore: () => ({ getSession: getSessionMock }),
}));
vi.mock("../specialist-prompts", () => ({
  getSpecialistByRole: specialistMock,
  getSpecialistById: specialistMock,
  buildDelegationPrompt: () => "delegation prompt",
}));
vi.mock("../delegation-depth", () => ({
  checkDelegationDepth: async () => ({ allowed: true, currentDepth: 1 }),
  calculateChildDepth: (depth: number) => depth + 1,
  buildAgentMetadata: () => ({}),
}));
vi.mock("@/core/storage/agent-memory-writer", () => ({
  AgentMemoryWriter: vi.fn(function MockWriter() {
    return { recordDelegation: async () => {}, recordChildSessionStart: async () => {}, recordChildCompletion: async () => {} };
  }),
}));

const { RoutaOrchestrator } = await import("../orchestrator");
const { AcpProcess } = await import("@/core/acp/acp-process");
const { resolveChildModelConfig, resolveRoleModel, buildChildModelEnv } = await import("../delegation-model-inheritance");

const LOCAL_MODEL = "claude-opus-5-5-pool";
const OFFICIAL_MODEL = "deepseek-v4-pro";

function modelOptions(current: string): AcpConfigOption[] {
  return [
    {
      id: "model",
      currentValue: current,
      options: [
        { group: "deepseek-official", name: "DeepSeek", options: [{ value: JSON.stringify(["deepseek-official", OFFICIAL_MODEL]), name: "DeepSeek V4 Pro" }] },
        { group: "local-7357", name: "Local 7357", options: [
          { value: JSON.stringify(["local-7357", LOCAL_MODEL]), name: "Opus" },
          { value: JSON.stringify(["local-7357", "gpt-6.1-sol"]), name: "GPT" },
        ] },
      ],
    },
    {
      id: "reasoning_effort",
      currentValue: "",
      options: ["", "low", "medium", "high", "xhigh", "max"].map((value) => ({ value, name: value || "Default" })),
    },
  ];
}

// ---------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------

describe("resolveChildModelConfig (AC4 rules)", () => {
  it("same provider: inherits the lead's model and effort", () => {
    expect(resolveChildModelConfig({ childProvider: "dsh", callerProvider: "dsh", callerModel: LOCAL_MODEL, callerReasoningEffort: "high" }))
      .toEqual({ model: LOCAL_MODEL, reasoningEffort: "high" });
  });

  it("different provider: inherits nothing", () => {
    expect(resolveChildModelConfig({ childProvider: "opencode", callerProvider: "dsh", callerModel: LOCAL_MODEL, callerReasoningEffort: "high", roleModel: "x" }))
      .toEqual({});
  });

  it("role model wins over the lead's model; effort still inherited", () => {
    expect(resolveChildModelConfig({ childProvider: "dsh", callerProvider: "dsh", callerModel: LOCAL_MODEL, callerReasoningEffort: "low", roleModel: "gpt-6.1-sol" }))
      .toEqual({ model: "gpt-6.1-sol", reasoningEffort: "low" });
  });

  it("role model: specialist model first, then crafterModel / gateModel / routaModel by role", () => {
    const config = { crafterModel: "c-model", gateModel: "g-model", routaModel: "r-model" };
    expect(resolveRoleModel(AgentRole.CRAFTER, undefined, config)).toBe("c-model");
    expect(resolveRoleModel(AgentRole.GATE, undefined, config)).toBe("g-model");
    expect(resolveRoleModel(AgentRole.ROUTA, undefined, config)).toBe("r-model");
    expect(resolveRoleModel(AgentRole.DEVELOPER, undefined, config)).toBeUndefined();
    expect(resolveRoleModel(AgentRole.CRAFTER, "spec-model", config)).toBe("spec-model");
  });

  it("DSH_ACP_MODEL only for a Local 7357 model on dsh", () => {
    expect(buildChildModelEnv("dsh", LOCAL_MODEL, modelOptions(""))).toEqual({ DSH_ACP_MODEL: LOCAL_MODEL });
    expect(buildChildModelEnv("dsh", OFFICIAL_MODEL, modelOptions(""))).toBeUndefined();
    expect(buildChildModelEnv("dsh", LOCAL_MODEL, undefined)).toBeUndefined();
    expect(buildChildModelEnv("opencode", LOCAL_MODEL, modelOptions(""))).toBeUndefined();
  });
});

describe("random cross-check against the AC4 text (F3 ①)", () => {
  // Judge written from the AC text, not from the implementation.
  function judge(input: { childProvider: string; callerProvider: string; callerModel?: string; callerReasoningEffort?: string; roleModel?: string }) {
    if (input.childProvider !== input.callerProvider) return {};
    const out: Record<string, string> = {};
    const model = input.roleModel || input.callerModel;
    if (model) out.model = model;
    if (input.callerReasoningEffort !== undefined) out.reasoningEffort = input.callerReasoningEffort;
    return out;
  }

  function lcg(seed: number) {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
  }

  function cases(count: number, seed: number) {
    const rand = lcg(seed);
    const pick = <T,>(values: T[]) => values[Math.floor(rand() * values.length)];
    const providers = ["dsh", "opencode", "claude", "codex", ""];
    return Array.from({ length: count }, () => ({
      childProvider: pick(providers),
      callerProvider: pick(providers),
      callerModel: pick([undefined, LOCAL_MODEL, OFFICIAL_MODEL, "gpt-6.1-sol"]),
      callerReasoningEffort: pick([undefined, "", "low", "high", "max"]),
      roleModel: pick([undefined, "role-a", "role-b"]),
    }));
  }

  function mismatches(impl: (input: ReturnType<typeof cases>[number]) => object, seed: number) {
    return cases(10_000, seed).filter((input) => JSON.stringify(impl(input)) !== JSON.stringify(judge(input))).length;
  }

  it("the judge catches a planted bug (effort inherited across providers)", () => {
    const planted = (input: ReturnType<typeof cases>[number]) => {
      const result = resolveChildModelConfig(input);
      return input.childProvider !== input.callerProvider && input.callerReasoningEffort
        ? { ...result, reasoningEffort: input.callerReasoningEffort }
        : result;
    };
    expect(mismatches(planted, 7)).toBeGreaterThan(0);
  });

  it("10,000 random inputs agree with the judge", () => {
    expect(mismatches(resolveChildModelConfig, 20261024)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Spawn path (generic ACP branch of spawnChildAgent)
// ---------------------------------------------------------------------------

function setup(options: {
  childProvider: string;
  caller?: { provider?: string; model?: string; reasoningEffort?: string };
  callerConfig?: AcpConfigOption[];
  specialistModel?: string;
  role?: AgentRole;
  orchestratorConfig?: { crafterModel?: string; gateModel?: string; routaModel?: string };
  childEfforts?: string[];
  createSession?: () => Promise<string>;
}) {
  const task = createTask({ id: "task-1", title: "Member task", objective: "Do it", workspaceId: "ws-1", position: 0, labels: [] });
  const role = options.role ?? AgentRole.CRAFTER;
  specialistMock.mockReturnValue({ id: "member", name: "Member", role, defaultModelTier: ModelTier.BALANCED, model: options.specialistModel });
  getSessionMock.mockImplementation((id: string) =>
    id === "caller-session" && options.caller ? { sessionId: id, cwd: tmpdir(), workspaceId: "ws-1", ...options.caller } : undefined);

  const childOptions: AcpConfigOption[] = modelOptions(JSON.stringify(["local-7357", "gpt-6.1-sol"]));
  if (options.childEfforts) {
    childOptions[1] = { ...childOptions[1], options: options.childEfforts.map((value) => ({ value })) };
  }
  const setConfigOption = vi.fn(async (_sessionId: string, configId: string, value: string) => {
    if (configId === "reasoning_effort" && options.childEfforts && !options.childEfforts.includes(value)) {
      throw new Error(`invalid reasoning_effort ${value}`);
    }
    const option = childOptions.find((entry) => entry.id === configId);
    if (option) option.currentValue = value;
    return childOptions;
  });
  const processManager = {
    killSession: vi.fn(),
    createSession: vi.fn<(...args: unknown[]) => Promise<string>>(options.createSession ?? (async () => "acp-child")),
    getProcess: vi.fn(() => undefined),
    getConfigOptions: vi.fn((sessionId: string) => {
      if (sessionId === "caller-session") {
        if (!options.callerConfig) throw new Error("no live lead process");
        return options.callerConfig;
      }
      return childOptions;
    }),
    setConfigOption,
  };
  const caller = createAgent({ id: "caller-agent", name: "Lead", role: AgentRole.ROUTA, workspaceId: "ws-1", modelTier: ModelTier.SMART, metadata: {} });
  const system = {
    eventBus: { on: vi.fn(), emit: vi.fn() },
    taskStore: { get: vi.fn(async () => task), save: vi.fn(async () => {}) },
    agentStore: {
      get: vi.fn(async (id: string) => (id === "caller-agent" ? caller : undefined)),
      listByWorkspace: vi.fn(async () => []),
      updateStatus: vi.fn(async () => {}),
    },
    conversationStore: {},
    tools: { createAgent: vi.fn(async () => ({ success: true, data: { agentId: "child-agent" } })), reportToParent: vi.fn() },
  };
  const orchestrator = new RoutaOrchestrator(system as never, processManager as never, {
    defaultCrafterProvider: options.childProvider,
    defaultGateProvider: options.childProvider,
    defaultCwd: tmpdir(),
    serverPort: "3999",
    ...options.orchestratorConfig,
  });
  const registered: Array<Record<string, unknown>> = [];
  orchestrator.setSessionRegistrationHandler((session) => registered.push(session));

  const delegate = () => orchestrator.delegateTaskWithSpawn({
    taskId: task.id,
    callerAgentId: "caller-agent",
    callerSessionId: "caller-session",
    workspaceId: "ws-1",
    specialist: role === AgentRole.GATE ? "gate" : "crafter",
    provider: options.childProvider,
    cwd: tmpdir(),
  });
  const extraEnvOf = () => processManager.createSession.mock.calls[0]?.[6];
  const setCalls = () => setConfigOption.mock.calls.map(([, configId, value]) => [configId, value]);
  return { delegate, processManager, registered, extraEnvOf, setCalls };
}

describe("spawnChildAgent passes the lead's model / effort (C2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("A: same dsh provider, Local 7357 model + high: env carries the model, set_config_option applies both", async () => {
    const t = setup({ childProvider: "dsh", caller: { provider: "dsh", model: LOCAL_MODEL, reasoningEffort: "high" }, callerConfig: modelOptions("") });
    const result = await t.delegate();
    expect(result.success).toBe(true);
    expect(t.extraEnvOf()).toEqual({ DSH_ACP_MODEL: LOCAL_MODEL });
    expect(t.setCalls()).toEqual([
      ["model", JSON.stringify(["local-7357", LOCAL_MODEL])],
      ["reasoning_effort", "high"],
    ]);
    expect(t.registered[0]).toMatchObject({ provider: "dsh", model: LOCAL_MODEL, reasoningEffort: "high" });
  });

  it("B: same dsh provider, DeepSeek official model: no env, model only via set_config_option", async () => {
    const t = setup({ childProvider: "dsh", caller: { provider: "dsh", model: OFFICIAL_MODEL, reasoningEffort: "high" }, callerConfig: modelOptions("") });
    await t.delegate();
    expect(t.extraEnvOf()).toBeUndefined();
    expect(t.setCalls()).toEqual([
      ["model", JSON.stringify(["deepseek-official", OFFICIAL_MODEL])],
      ["reasoning_effort", "high"],
    ]);
    expect(t.registered[0]).toMatchObject({ model: OFFICIAL_MODEL, reasoningEffort: "high" });
  });

  it("B': lead process gone (options unknown): model is not put in env", async () => {
    const t = setup({ childProvider: "dsh", caller: { provider: "dsh", model: LOCAL_MODEL, reasoningEffort: "high" } });
    await t.delegate();
    expect(t.extraEnvOf()).toBeUndefined();
    expect(t.setCalls()[0]).toEqual(["model", JSON.stringify(["local-7357", LOCAL_MODEL])]);
  });

  it("C: different provider: no env, no model, no effort", async () => {
    const t = setup({ childProvider: "opencode", caller: { provider: "dsh", model: LOCAL_MODEL, reasoningEffort: "high" }, callerConfig: modelOptions("") });
    await t.delegate();
    expect(t.extraEnvOf()).toBeUndefined();
    expect(t.setCalls()).toEqual([]);
    expect(t.registered[0]?.model).toBeUndefined();
    expect(t.registered[0]?.reasoningEffort).toBeUndefined();
  });

  it("D: specialist model wins; effort still the lead's", async () => {
    const t = setup({ childProvider: "dsh", caller: { provider: "dsh", model: OFFICIAL_MODEL, reasoningEffort: "low" }, callerConfig: modelOptions(""), specialistModel: "gpt-6.1-sol" });
    await t.delegate();
    expect(t.extraEnvOf()).toEqual({ DSH_ACP_MODEL: "gpt-6.1-sol" });
    expect(t.setCalls()).toEqual([["reasoning_effort", "low"]]); // child already on gpt-6.1-sol
    expect(t.registered[0]).toMatchObject({ model: "gpt-6.1-sol", reasoningEffort: "low" });
  });

  it("E: lead's effort not offered by the child: child still starts, only a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = setup({ childProvider: "dsh", caller: { provider: "dsh", model: LOCAL_MODEL, reasoningEffort: "max" }, callerConfig: modelOptions(""), childEfforts: ["", "low", "high"] });
    const result = await t.delegate();
    expect(result.success).toBe(true);
    expect(warn.mock.calls.some((call) => String(call[0]).includes("[Orchestrator]"))).toBe(true);
    expect(t.registered[0]).toMatchObject({ model: LOCAL_MODEL });
    warn.mockRestore();
  });

  it("F2 ④: lead without stored model / effort: createSession args as before, no set_config_option", async () => {
    const t = setup({ childProvider: "dsh", caller: { provider: "dsh" }, callerConfig: modelOptions("") });
    await t.delegate();
    expect(t.processManager.createSession.mock.calls[0]?.slice(3)).toEqual(["dsh", undefined, undefined, undefined, "ws-1"]);
    expect(t.setCalls()).toEqual([]);
  });
});

describe("every execution path shows the new effect (F4 ③–⑤)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    [AgentRole.CRAFTER, { crafterModel: "gpt-6.1-sol" }],
    [AgentRole.GATE, { gateModel: "gpt-6.1-sol" }],
  ] as const)("④ role %s uses its OrchestratorConfig model", async (role, orchestratorConfig) => {
    const t = setup({ role, childProvider: "dsh", caller: { provider: "dsh", model: LOCAL_MODEL, reasoningEffort: "high" }, callerConfig: modelOptions(""), orchestratorConfig });
    await t.delegate();
    expect(t.extraEnvOf()).toEqual({ DSH_ACP_MODEL: "gpt-6.1-sol" });
    expect(t.registered[0]).toMatchObject({ model: "gpt-6.1-sol", reasoningEffort: "high" });
  });

  it("④ role ROUTA uses routaModel (rule level: delegation only spawns CRAFTER / GATE specialists here)", () => {
    expect(resolveChildModelConfig({
      childProvider: "dsh", callerProvider: "dsh", callerModel: LOCAL_MODEL, callerReasoningEffort: "high",
      roleModel: resolveRoleModel(AgentRole.ROUTA, undefined, { routaModel: "r-model" }),
    })).toEqual({ model: "r-model", reasoningEffort: "high" });
  });

  it("⑤ another ACP provider (opencode → opencode): model / effort via set_config_option only", async () => {
    const t = setup({ childProvider: "opencode", caller: { provider: "opencode", model: LOCAL_MODEL, reasoningEffort: "medium" }, callerConfig: modelOptions("") });
    await t.delegate();
    expect(t.extraEnvOf()).toBeUndefined();
    expect(t.setCalls()).toEqual([
      ["model", JSON.stringify(["local-7357", LOCAL_MODEL])],
      ["reasoning_effort", "medium"],
    ]);
    expect(t.registered[0]).toMatchObject({ provider: "opencode", model: LOCAL_MODEL, reasoningEffort: "medium" });
  });

  it("③ member provider command missing: delegation returns an error naming it, nothing escapes", async () => {
    const realKill = ChildProcess.prototype.kill;
    const killCalls: Array<number | undefined> = [];
    vi.spyOn(ChildProcess.prototype, "kill").mockImplementation(function (this: ChildProcess, signal?: NodeJS.Signals | number) {
      killCalls.push(this.pid);
      return this.pid ? realKill.call(this, signal) : false;
    });
    const escaped: unknown[] = [];
    const onEscape = (error: unknown) => escaped.push(error);
    process.on("uncaughtException", onEscape);
    process.on("unhandledRejection", onEscape);
    const command = `routa-missing-member-${Date.now()}`;
    const t = setup({
      childProvider: "dsh",
      caller: { provider: "dsh", model: LOCAL_MODEL, reasoningEffort: "high" },
      callerConfig: modelOptions(""),
      createSession: async () => {
        const proc = new AcpProcess({ command, args: [], cwd: tmpdir(), displayName: "Member" }, () => {});
        try {
          await proc.start();
        } catch (error) {
          proc.kill();
          throw error;
        }
        return "never";
      },
    });
    try {
      const result = await t.delegate();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(result.success).toBe(false);
      expect(result.error).toContain(command);
      expect(killCalls.filter((pid) => !pid)).toEqual([]);
      expect(escaped).toEqual([]);
    } finally {
      process.off("uncaughtException", onEscape);
      process.off("unhandledRejection", onEscape);
      vi.restoreAllMocks();
    }
  });
});
