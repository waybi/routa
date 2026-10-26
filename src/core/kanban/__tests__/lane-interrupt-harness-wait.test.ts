// @vitest-environment node
/**
 * The harness waits (waitForStep / waitForStepEnd) must tolerate a slow
 * machine: cold module loads inside the orchestrator take 2.3-2.6 s under
 * load, past vi.waitFor's default 1 s. They wait up to 10 s instead.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { triggerAssignedTaskAgentMock } = vi.hoisted(() => ({ triggerAssignedTaskAgentMock: vi.fn() }));

vi.mock("@/core/acp/session-prompt", () => ({ dispatchSessionPrompt: vi.fn() }));
vi.mock("../agent-trigger", () => ({
  triggerAssignedTaskAgent: triggerAssignedTaskAgentMock,
  getInternalApiOrigin: vi.fn(() => "http://localhost"),
}));
vi.mock("../../acp/processer", () => ({
  getAcpProcessManager: () => ({ killSession: vi.fn(async () => undefined), hasActiveSession: () => false }),
}));

import { resetWorkflowOrchestrator } from "../workflow-orchestrator-singleton";
import { cleanupSessionCwd, createLaneHarness, waitForStepEnd, type LaneHarness } from "./lane-interrupt-harness";

const SLOW_MS = 2_500;

beforeEach(() => {
  vi.stubEnv("ROUTA_DB_DRIVER", "memory");
  resetWorkflowOrchestrator();
  triggerAssignedTaskAgentMock.mockReset();
});

afterEach(() => {
  resetWorkflowOrchestrator();
  vi.unstubAllEnvs();
});

afterAll(() => cleanupSessionCwd());

/** A harness stub whose lane record leaves "running" after `afterMs` (never when undefined). */
function slowLaneRecord(afterMs: number | undefined): LaneHarness {
  const start = Date.now();
  return {
    laneRecord: async () => ({
      status: afterMs !== undefined && Date.now() - start >= afterMs ? "completed" : "running",
    }),
  } as unknown as LaneHarness;
}

describe.concurrent("lane-interrupt-harness waits", () => {
  it("waitForStep returns a step that starts 2.5 s later", async () => {
    const h = await createLaneHarness("todo", triggerAssignedTaskAgentMock, { cardId: "card-wait-slow" });
    setTimeout(() => h.sessionsByStep.set(0, ["late-session"]), SLOW_MS);
    const start = Date.now();
    await expect(h.waitForStep(0)).resolves.toBe("late-session");
    expect(Date.now() - start).toBeGreaterThanOrEqual(SLOW_MS - 50);
  }, 20_000);

  it("waitForStep gives up after about 10 s, not 1 s", async () => {
    const h = await createLaneHarness("todo", triggerAssignedTaskAgentMock, { cardId: "card-wait-never" });
    const start = Date.now();
    await expect(h.waitForStep(0)).rejects.toThrow("step 0 not started");
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(9_000);
    expect(elapsed).toBeLessThan(12_000);
  }, 20_000);

  it("waitForStepEnd returns once a record ends 2.5 s later", async () => {
    const start = Date.now();
    await expect(waitForStepEnd(slowLaneRecord(SLOW_MS), "s-slow")).resolves.toBeUndefined();
    expect(Date.now() - start).toBeGreaterThanOrEqual(SLOW_MS);
  }, 20_000);

  it("waitForStepEnd gives up after about 10 s, not 1 s", async () => {
    const start = Date.now();
    await expect(waitForStepEnd(slowLaneRecord(undefined), "s-never")).rejects.toThrow("s-never still running");
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(9_000);
    expect(elapsed).toBeLessThan(12_000);
  }, 20_000);
});
