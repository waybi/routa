/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it } from "vitest";
import { AgentTools } from "../agent-tools";
import { AgentEventType, EventBus } from "../../events/event-bus";
import { InMemoryAgentStore } from "../../store/agent-store";
import { InMemoryConversationStore } from "../../store/conversation-store";
import { InMemoryTaskStore } from "../../store/task-store";
import { createTask } from "../../models/task";
import { createKanbanBoard } from "../../models/kanban";
import { InMemoryKanbanBoardStore } from "../../store/kanban-board-store";
import { getHttpSessionStore } from "../../acp/http-session-store";

describe("AgentTools.createTask", () => {
  let tools: AgentTools;
  let taskStore: InMemoryTaskStore;

  beforeEach(() => {
    taskStore = new InMemoryTaskStore();
    tools = new AgentTools(
      new InMemoryAgentStore(),
      new InMemoryConversationStore(),
      taskStore,
      new EventBus(),
    );
  });

  it("persists creationSource for session tasks", async () => {
    const result = await tools.createTask({
      title: "Session task",
      objective: "Keep task scoped to the session UI",
      workspaceId: "workspace-1",
      creationSource: "session",
    });

    expect(result.success).toBe(true);

    const taskId = (result.data as { taskId: string }).taskId;
    const task = await taskStore.get(taskId);
    expect(task?.creationSource).toBe("session");
  });
});

describe("AgentTools.updateTask synthetic completion", () => {
  let tools: AgentTools;
  let taskStore: InMemoryTaskStore;
  let eventBus: EventBus;

  beforeEach(() => {
    taskStore = new InMemoryTaskStore();
    eventBus = new EventBus();
    tools = new AgentTools(
      new InMemoryAgentStore(),
      new InMemoryConversationStore(),
      taskStore,
      eventBus,
    );
  });

  it("emits AGENT_COMPLETED when a running review gate writes verdict and report", async () => {
    const task = createTask({
      id: "task-review",
      title: "Review task",
      objective: "Allow review guard to continue",
      workspaceId: "workspace-1",
      columnId: "review",
    });
    task.laneSessions = [{
      sessionId: "session-review-1",
      columnId: "review",
      columnName: "Review",
      provider: "codex",
      role: "GATE",
      status: "running",
      completionRequirement: "verification_report",
      stepId: "qa-frontend",
      stepIndex: 0,
      stepName: "QA Frontend",
      startedAt: new Date().toISOString(),
    }];
    await taskStore.save(task);

    const events: AgentEventType[] = [];
    let completionPayload: Record<string, unknown> | undefined;
    eventBus.on("capture", (event) => {
      events.push(event.type);
      if (event.type === AgentEventType.AGENT_COMPLETED) {
        completionPayload = event.data;
      }
    });

    const result = await tools.updateTask({
      taskId: task.id,
      updates: {
        verificationVerdict: "APPROVED",
        verificationReport: "QA passed with screenshot and test results.",
      },
      agentId: "session-review-1",
    });

    expect(result.success).toBe(true);
    expect(events).toContain(AgentEventType.AGENT_COMPLETED);
    expect(completionPayload).toMatchObject({
      sessionId: "session-review-1",
      success: true,
      synthesizedBy: "updateTask",
      trigger: "verification_report",
      taskId: task.id,
    });
  });

  it("emits AGENT_COMPLETED only after verdict and report are both persisted across separate updates", async () => {
    const task = createTask({
      id: "task-review-split",
      title: "Review task split updates",
      objective: "Allow review guard to continue after separate writes",
      workspaceId: "workspace-1",
      columnId: "review",
      triggerSessionId: "session-review-1",
    });
    task.laneSessions = [{
      sessionId: "session-review-1",
      columnId: "review",
      columnName: "Review",
      provider: "codex",
      role: "GATE",
      status: "running",
      completionRequirement: "verification_report",
      stepId: "qa-frontend",
      stepIndex: 0,
      stepName: "QA Frontend",
      startedAt: new Date().toISOString(),
    }];
    await taskStore.save(task);

    const events: AgentEventType[] = [];
    let completionPayload: Record<string, unknown> | undefined;
    eventBus.on("capture", (event) => {
      events.push(event.type);
      if (event.type === AgentEventType.AGENT_COMPLETED) {
        completionPayload = event.data;
      }
    });

    const verdictResult = await tools.updateTask({
      taskId: task.id,
      updates: {
        verificationVerdict: "APPROVED",
      },
      agentId: "system",
    });

    expect(verdictResult.success).toBe(true);
    expect(events).not.toContain(AgentEventType.AGENT_COMPLETED);

    const reportResult = await tools.updateTask({
      taskId: task.id,
      updates: {
        verificationReport: "QA passed with screenshot and test results.",
      },
      agentId: "system",
    });

    expect(reportResult.success).toBe(true);
    expect(events).toContain(AgentEventType.AGENT_COMPLETED);
    expect(completionPayload).toMatchObject({
      sessionId: "session-review-1",
      success: true,
      synthesizedBy: "updateTask",
      trigger: "verification_report",
      taskId: task.id,
    });
  });

  it("does not emit AGENT_COMPLETED when a non-review running session only writes a verdict", async () => {
    const task = createTask({
      id: "task-dev",
      title: "Dev task",
      objective: "Do not synthesize unrelated completion",
      workspaceId: "workspace-1",
      columnId: "dev",
    });
    task.laneSessions = [{
      sessionId: "session-dev-1",
      columnId: "dev",
      columnName: "Dev",
      provider: "codex",
      role: "CRAFTER",
      status: "running",
      stepId: "dev-executor",
      stepIndex: 0,
      stepName: "Dev Crafter",
      startedAt: new Date().toISOString(),
    }];
    await taskStore.save(task);

    const events: AgentEventType[] = [];
    eventBus.on("capture", (event) => {
      events.push(event.type);
    });

    const result = await tools.updateTask({
      taskId: task.id,
      updates: {
        verificationVerdict: "APPROVED",
      },
      agentId: "session-dev-1",
    });

    expect(result.success).toBe(true);
    expect(events).not.toContain(AgentEventType.AGENT_COMPLETED);
  });

  it("persists contextSearchSpec updates", async () => {
    const task = createTask({
      id: "task-context-search",
      title: "Context search spec",
      objective: "Persist retrieval hints on the task",
      workspaceId: "workspace-1",
      columnId: "backlog",
    });
    await taskStore.save(task);

    const result = await tools.updateTask({
      taskId: task.id,
      updates: {
        contextSearchSpec: {
          query: "jit context kanban",
          featureCandidates: ["kanban-workflow"],
          relatedFiles: ["src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx"],
        },
      },
      agentId: "system",
    });

    expect(result.success).toBe(true);
    const updated = await taskStore.get(task.id);
    expect(updated?.contextSearchSpec).toEqual({
      query: "jit context kanban",
      featureCandidates: ["kanban-workflow"],
      relatedFiles: ["src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx"],
    });
  });

  it("strips speculative backlog contextSearchSpec updates before repo inspection", async () => {
    const task = createTask({
      id: "task-context-search-strip",
      title: "Context search spec strip",
      objective: "Do not persist speculative retrieval hints",
      workspaceId: "workspace-1",
      columnId: "backlog",
    });
    await taskStore.save(task);

    const sessionId = `session-update-no-confirm-${Date.now()}`;
    const sessionStore = getHttpSessionStore();
    sessionStore.upsertSession({
      sessionId,
      workspaceId: "workspace-1",
      cwd: "/tmp/repo",
      createdAt: new Date().toISOString(),
    });
    sessionStore.pushNotificationToHistory(sessionId, {
      sessionId,
      update: {
        sessionUpdate: "tool_call",
        tool: "search_cards",
        kind: "task",
      },
    });

    const result = await tools.updateTask({
      taskId: task.id,
      sessionId,
      updates: {
        contextSearchSpec: {
          query: "jit context kanban",
          featureCandidates: ["kanban-workflow"],
          relatedFiles: ["src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx"],
        },
      },
      agentId: "system",
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      warnings: [expect.stringContaining("Ignored contextSearchSpec")],
    });

    const updated = await taskStore.get(task.id);
    expect(updated?.contextSearchSpec).toBeUndefined();
  });

  it("persists backlog contextSearchSpec updates after confirmed repo inspection", async () => {
    const task = createTask({
      id: "task-context-search-confirm",
      title: "Context search spec confirm",
      objective: "Persist retrieval hints once confirmed",
      workspaceId: "workspace-1",
      columnId: "backlog",
    });
    await taskStore.save(task);

    const sessionId = `session-update-confirm-${Date.now()}`;
    const sessionStore = getHttpSessionStore();
    sessionStore.upsertSession({
      sessionId,
      workspaceId: "workspace-1",
      cwd: "/tmp/repo",
      createdAt: new Date().toISOString(),
    });
    sessionStore.pushNotificationToHistory(sessionId, {
      sessionId,
      update: {
        sessionUpdate: "tool_call",
        tool: "load_feature_tree_context",
        kind: "glob",
      },
    });

    const result = await tools.updateTask({
      taskId: task.id,
      sessionId,
      updates: {
        contextSearchSpec: {
          query: "jit context kanban",
          featureCandidates: ["kanban-workflow"],
          relatedFiles: ["src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx"],
        },
      },
      agentId: "system",
    });

    expect(result.success).toBe(true);

    const updated = await taskStore.get(task.id);
    expect(updated?.contextSearchSpec).toEqual({
      query: "jit context kanban",
      featureCandidates: ["kanban-workflow"],
      relatedFiles: ["src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx"],
    });
  });
});

describe("AgentTools.updateTask description write guard", () => {
  const CANONICAL_STORY_OBJECTIVE = `# Refined Story

\`\`\`yaml
story:
  version: 1
  language: en
  title: User can update profile
  problem_statement: Users cannot manage their own profile information.
  user_value: Users need self-service account management.
  acceptance_criteria:
    - id: AC1
      text: User can edit display name from settings.
      testable: true
    - id: AC2
      text: Updated display name persists after refresh.
      testable: true
  constraints_and_affected_areas:
    - src/app/settings/page.tsx
  dependencies_and_sequencing:
    independent_story_check: pass
    depends_on:
      - none
    unblock_condition: Ready to start now.
  out_of_scope:
    - Avatar uploads
  invest:
    independent:
      status: pass
      reason: Ships on its own.
    negotiable:
      status: pass
      reason: Field list can change.
    valuable:
      status: pass
      reason: Users gain direct value.
    estimable:
      status: pass
      reason: Touched files identified.
    small:
      status: pass
      reason: One settings flow.
    testable:
      status: pass
      reason: AC is verifiable.
\`\`\`
`;

  let tools: AgentTools;
  let taskStore: InMemoryTaskStore;
  let boardStore: InMemoryKanbanBoardStore;

  beforeEach(async () => {
    taskStore = new InMemoryTaskStore();
    boardStore = new InMemoryKanbanBoardStore();
    tools = new AgentTools(
      new InMemoryAgentStore(),
      new InMemoryConversationStore(),
      taskStore,
      new EventBus(),
    );
    tools.setKanbanBoardStore(boardStore);

    const board = createKanbanBoard({
      id: "board-guard",
      workspaceId: "workspace-1",
      name: "Guard Board",
      isDefault: true,
      columns: [
        { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
        {
          id: "todo",
          name: "Todo",
          position: 1,
          stage: "todo",
          automation: {
            enabled: true,
            contractRules: {
              requireCanonicalStory: true,
              loopBreakerThreshold: 2,
            },
          },
        },
        { id: "dev", name: "Dev", position: 2, stage: "dev" },
      ],
    });
    await boardStore.save(board);
  });

  it("rejects an objective overwrite that would fail the next contract gate", async () => {
    // Regression for docs/issues/2026-09-21-update-task-objective-clobbers-gated-description.md:
    // update_card wrote a gated canonical YAML description, then update_task
    // silently replaced it with a one-sentence objective.
    const task = createTask({
      id: "task-guard-clobber",
      title: "Guarded card",
      objective: CANONICAL_STORY_OBJECTIVE,
      workspaceId: "workspace-1",
      boardId: "board-guard",
      columnId: "backlog",
    });
    await taskStore.save(task);

    const result = await tools.updateTask({
      taskId: task.id,
      updates: {
        objective: "Short one-sentence summary without canonical YAML.",
        scope: "Some scope text",
      },
      agentId: "system",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Cannot update card description");
    expect(result.error).toContain("update_card");

    const persisted = await taskStore.get(task.id);
    expect(persisted?.objective).toBe(CANONICAL_STORY_OBJECTIVE);
  });

  it("rejects objective rewrites from dev onward (description frozen)", async () => {
    const task = createTask({
      id: "task-guard-frozen",
      title: "Frozen card",
      objective: CANONICAL_STORY_OBJECTIVE,
      workspaceId: "workspace-1",
      boardId: "board-guard",
      columnId: "dev",
    });
    await taskStore.save(task);

    const result = await tools.updateTask({
      taskId: task.id,
      updates: { objective: "Rewrite the frozen story" },
      agentId: "system",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("frozen");

    const persisted = await taskStore.get(task.id);
    expect(persisted?.objective).toBe(CANONICAL_STORY_OBJECTIVE);
  });

  it("allows an objective write that still satisfies the contract gate", async () => {
    const task = createTask({
      id: "task-guard-valid",
      title: "Valid rewrite",
      objective: "Only prose here",
      workspaceId: "workspace-1",
      boardId: "board-guard",
      columnId: "backlog",
    });
    await taskStore.save(task);

    const result = await tools.updateTask({
      taskId: task.id,
      updates: { objective: CANONICAL_STORY_OBJECTIVE },
      agentId: "system",
    });

    expect(result.success).toBe(true);
    const persisted = await taskStore.get(task.id);
    expect(persisted?.objective).toBe(CANONICAL_STORY_OBJECTIVE);
  });

  it("accepts resending the identical objective (idempotent)", async () => {
    const task = createTask({
      id: "task-guard-idempotent",
      title: "Idempotent write",
      objective: CANONICAL_STORY_OBJECTIVE,
      workspaceId: "workspace-1",
      boardId: "board-guard",
      columnId: "dev",
    });
    await taskStore.save(task);

    const result = await tools.updateTask({
      taskId: task.id,
      updates: { objective: CANONICAL_STORY_OBJECTIVE, scope: "narrowed scope" },
      agentId: "system",
    });

    expect(result.success).toBe(true);
    const persisted = await taskStore.get(task.id);
    expect(persisted?.scope).toBe("narrowed scope");
  });

  it("leaves non-board tasks unaffected", async () => {
    const task = createTask({
      id: "task-guard-plain",
      title: "Plain task",
      objective: "Original objective",
      workspaceId: "workspace-1",
    });
    await taskStore.save(task);

    const result = await tools.updateTask({
      taskId: task.id,
      updates: { objective: "New objective for a non-kanban task" },
      agentId: "system",
    });

    expect(result.success).toBe(true);
    const persisted = await taskStore.get(task.id);
    expect(persisted?.objective).toBe("New objective for a non-kanban task");
  });
});
