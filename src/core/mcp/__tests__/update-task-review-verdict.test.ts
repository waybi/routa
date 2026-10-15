/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { EventBus } from "../../events/event-bus";
import { createKanbanBoard, type KanbanColumn } from "../../models/kanban";
import { createTask, type Task } from "../../models/task";
import { InMemoryAgentStore } from "../../store/agent-store";
import { InMemoryConversationStore } from "../../store/conversation-store";
import { InMemoryKanbanBoardStore } from "../../store/kanban-board-store";
import { InMemoryTaskStore } from "../../store/task-store";
import { AgentTools } from "../../tools/agent-tools";
import { KanbanTools } from "../../tools/kanban-tools";
import { canSessionWriteVerificationVerdict } from "../../kanban/review-verdict-authority";
import { executeMcpTool, getMcpToolDefinitions } from "../mcp-tool-executor";
import { RoutaMcpToolManager } from "../routa-mcp-tool-manager";

const REVIEW_GUARD_SESSION = "review-guard-session";
const QA_FRONTEND_SESSION = "qa-frontend-session";
const DEV_SESSION = "dev-session";

const columns: KanbanColumn[] = [
  { id: "dev", name: "Dev", position: 0, stage: "dev" },
  {
    id: "review",
    name: "Review",
    position: 1,
    stage: "review",
    automation: {
      enabled: true,
      steps: [
        { id: "qa-frontend", role: "GATE", specialistId: "kanban-qa-frontend", specialistName: "QA Frontend" },
        { id: "review-guard", role: "GATE", specialistId: "kanban-review-guard", specialistName: "Review Guard" },
      ],
      requiredArtifacts: ["screenshot", "test_results"],
    },
  },
  { id: "done", name: "Done", position: 2, stage: "done" },
];

function buildReviewTask(): Task {
  const task = createTask({
    id: "task-1",
    title: "Review me",
    objective: "Ship the fix",
    workspaceId: "ws-1",
    boardId: "board-1",
    columnId: "review",
  });
  const startedAt = new Date().toISOString();
  task.triggerSessionId = REVIEW_GUARD_SESSION;
  task.laneSessions = [
    { sessionId: DEV_SESSION, columnId: "dev", stepIndex: 0, role: "CRAFTER", status: "transitioned", startedAt },
    { sessionId: QA_FRONTEND_SESSION, columnId: "review", stepIndex: 0, role: "GATE", status: "completed", startedAt },
    { sessionId: REVIEW_GUARD_SESSION, columnId: "review", stepIndex: 1, role: "GATE", status: "running", startedAt },
  ];
  return task;
}

function createServerRecorder() {
  const registrations = new Map<string, {
    schema: z.ZodRawShape;
    handler: (params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
  }>();
  return {
    registrations,
    server: {
      tool(
        name: string,
        _description: string,
        schema: z.ZodRawShape,
        handler: (params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>,
      ) {
        registrations.set(name, { schema, handler });
      },
    },
  };
}

describe("update_task verification verdict under kanban-planning", () => {
  let taskStore: InMemoryTaskStore;
  let tools: AgentTools;
  let kanbanTools: KanbanTools;

  beforeEach(async () => {
    taskStore = new InMemoryTaskStore();
    const boardStore = new InMemoryKanbanBoardStore();
    tools = new AgentTools(new InMemoryAgentStore(), new InMemoryConversationStore(), taskStore, new EventBus());
    tools.setKanbanBoardStore(boardStore);
    kanbanTools = new KanbanTools(boardStore, taskStore);
    await boardStore.save(createKanbanBoard({ id: "board-1", workspaceId: "ws-1", name: "Board", columns }));
    await taskStore.save(buildReviewTask());
  });

  /** Mirrors the MCP SDK: arguments are parsed through the registered zod shape before the handler runs. */
  async function callManagerUpdateTask(sessionId: string, args: Record<string, unknown>) {
    const manager = new RoutaMcpToolManager(tools, "ws-1");
    manager.setToolMode("full");
    manager.setMcpProfile("kanban-planning");
    manager.setSessionId(sessionId);
    manager.setKanbanTools(kanbanTools);
    const { registrations, server } = createServerRecorder();
    manager.registerTools(server as never);
    const tool = registrations.get("update_task");
    expect(tool).toBeDefined();
    const parsed = z.object(tool!.schema).parse(args);
    const result = await tool!.handler(parsed);
    return { result, payload: JSON.parse(result.content[0]!.text) as Record<string, unknown> };
  }

  it("lets the Review lane GATE session persist verificationVerdict and verificationReport (MCP server path)", async () => {
    const { result, payload } = await callManagerUpdateTask(REVIEW_GUARD_SESSION, {
      taskId: "task-1",
      verificationVerdict: "APPROVED",
      verificationReport: "All AC verified.",
    });

    expect(result.isError).toBeFalsy();
    expect(payload.updatedFields).toEqual(expect.arrayContaining(["verificationVerdict", "verificationReport"]));
    const stored = await taskStore.get("task-1");
    expect(stored?.verificationVerdict).toBe("APPROVED");
    expect(stored?.verificationReport).toBe("All AC verified.");
  });

  it("rejects verdict writes from sessions outside the Review lane GATE (MCP server path)", async () => {
    const { result, payload } = await callManagerUpdateTask(DEV_SESSION, {
      taskId: "task-1",
      verificationVerdict: "APPROVED",
    });

    expect(result.isError).toBe(true);
    expect(String(payload.error)).toContain("verificationVerdict");
    expect((await taskStore.get("task-1"))?.verificationVerdict).toBeUndefined();
  });

  it("still rejects status, completionSummary and assignedTo with an explicit error (MCP server path)", async () => {
    for (const [field, value] of [
      ["status", "COMPLETED"],
      ["completionSummary", "done"],
      ["assignedTo", "agent-x"],
    ] as const) {
      const { result, payload } = await callManagerUpdateTask(REVIEW_GUARD_SESSION, {
        taskId: "task-1",
        [field]: value,
      });
      expect(result.isError).toBe(true);
      expect(String(payload.error)).toContain(field);
    }
    const stored = await taskStore.get("task-1");
    expect(stored?.completionSummary).toBeUndefined();
    expect(stored?.assignedTo).toBeUndefined();
  });

  it("lets the Review lane GATE session write the verdict through the HTTP executor path", async () => {
    const result = await executeMcpTool(tools, "update_task", {
      workspaceId: "ws-1",
      taskId: "task-1",
      sessionId: REVIEW_GUARD_SESSION,
      verificationVerdict: "APPROVED",
      verificationReport: "Looks good.",
    }, undefined, undefined, kanbanTools, "kanban-planning");

    expect(result).toMatchObject({ isError: false });
    const payload = JSON.parse((result as { content: Array<{ text: string }> }).content[0]!.text);
    expect(payload.updatedFields).toEqual(expect.arrayContaining(["verificationVerdict", "verificationReport"]));
    expect((await taskStore.get("task-1"))?.verificationVerdict).toBe("APPROVED");
  });

  it("rejects verdict writes from non-GATE sessions and protected fields through the HTTP executor path", async () => {
    const verdict = await executeMcpTool(tools, "update_task", {
      workspaceId: "ws-1",
      taskId: "task-1",
      sessionId: DEV_SESSION,
      verificationVerdict: "APPROVED",
    }, undefined, undefined, kanbanTools, "kanban-planning");
    expect(verdict).toMatchObject({ isError: true });

    const status = await executeMcpTool(tools, "update_task", {
      workspaceId: "ws-1",
      taskId: "task-1",
      sessionId: REVIEW_GUARD_SESSION,
      status: "COMPLETED",
    }, undefined, undefined, kanbanTools, "kanban-planning");
    expect(status).toMatchObject({ isError: true });
    expect((await taskStore.get("task-1"))?.verificationVerdict).toBeUndefined();
  });

  it("advertises verificationVerdict/verificationReport but not status/completionSummary/assignedTo in the planning tool definition", () => {
    const definition = getMcpToolDefinitions("full", "kanban-planning").find((tool) => tool.name === "update_task");
    const properties = definition?.inputSchema?.properties as Record<string, unknown>;
    expect(properties).toHaveProperty("verificationVerdict");
    expect(properties).toHaveProperty("verificationReport");
    expect(properties).not.toHaveProperty("status");
    expect(properties).not.toHaveProperty("completionSummary");
    expect(properties).not.toHaveProperty("assignedTo");
  });
});

describe("canSessionWriteVerificationVerdict", () => {
  it("accepts only a GATE lane session of the task's current review-stage column", () => {
    const task = buildReviewTask();
    expect(canSessionWriteVerificationVerdict(task, REVIEW_GUARD_SESSION, columns)).toBe(true);
    expect(canSessionWriteVerificationVerdict(task, QA_FRONTEND_SESSION, columns)).toBe(true);
    expect(canSessionWriteVerificationVerdict(task, DEV_SESSION, columns)).toBe(false);
    expect(canSessionWriteVerificationVerdict(task, "unknown-session", columns)).toBe(false);
    expect(canSessionWriteVerificationVerdict(task, undefined, columns)).toBe(false);
  });

  it("rejects review sessions once the task has left the review column", () => {
    const task = { ...buildReviewTask(), columnId: "dev" };
    expect(canSessionWriteVerificationVerdict(task, REVIEW_GUARD_SESSION, columns)).toBe(false);
  });

  it("falls back to the column step role when the lane session did not record one", () => {
    const task = buildReviewTask();
    task.laneSessions = task.laneSessions!.map((session) => (
      session.sessionId === REVIEW_GUARD_SESSION ? { ...session, role: undefined } : session
    ));
    expect(canSessionWriteVerificationVerdict(task, REVIEW_GUARD_SESSION, columns)).toBe(true);
  });
});
