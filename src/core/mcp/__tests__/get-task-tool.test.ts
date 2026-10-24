/**
 * @vitest-environment node
 *
 * get_task must reach every MCP entry point (card ed9adb91, retro L296):
 * each entry is called for real, not only checked by name.
 */
import crypto from "crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { EventBus } from "../../events/event-bus";
import { createKanbanBoard } from "../../models/kanban";
import { InMemoryAgentStore } from "../../store/agent-store";
import { InMemoryConversationStore } from "../../store/conversation-store";
import { InMemoryKanbanBoardStore } from "../../store/kanban-board-store";
import { InMemoryTaskStore } from "../../store/task-store";
import { AgentTools } from "../../tools/agent-tools";
import { KanbanTools } from "../../tools/kanban-tools";
import { buildFixedCard } from "../../tools/__tests__/get-task-fixtures";
import { GET_TASK_TOOL_DEFINITION } from "../get-task-tool";
import { executeMcpTool, getMcpToolDefinitions } from "../mcp-tool-executor";
import { getMcpProfileToolAllowlist, type McpServerProfile } from "../mcp-server-profiles";
import { RoutaMcpToolManager, type ToolMode } from "../routa-mcp-tool-manager";

/** Tool names and definition hashes recorded on baseline 46e6bad9 (before get_task existed). */
const BASELINE = {
  essential: ["assemble_task_adaptive_harness", "capture_screenshot", "confirm_feature_tree_story_context", "create_agent", "delegate_task", "delegate_task_to_agent", "fetch_webpage", "get_artifact", "inspect_transcript_turns", "list_agents", "list_artifacts", "list_pending_artifact_requests", "load_feature_retrospective_memory", "load_feature_tree_context", "move_card", "provide_artifact", "read_agent_conversation", "read_specialist_spec_resource", "report_to_parent", "request_artifact", "request_previous_lane_handoff", "save_feature_retrospective_memory", "save_history_memory_context", "save_reasoning_memory", "search_reasoning_memories", "send_message_to_agent", "set_agent_name", "submit_lane_handoff", "summarize_file_session_context", "summarize_task_history_context", "update_card"],
  full: ["append_to_note", "assemble_task_adaptive_harness", "capture_screenshot", "confirm_feature_tree_story_context", "convert_task_blocks", "create_agent", "create_board", "create_card", "create_note", "create_task", "create_workspace", "decompose_tasks", "delegate_task", "delegate_task_to_agent", "delete_card", "fetch_webpage", "get_agent_status", "get_agent_summary", "get_artifact", "get_board", "get_my_task", "get_workspace_details", "get_workspace_info", "git_commit", "git_diff", "git_status", "inspect_transcript_turns", "list_agents", "list_artifacts", "list_boards", "list_cards_by_column", "list_notes", "list_pending_artifact_requests", "list_specialists", "list_tasks", "list_workspaces", "load_feature_retrospective_memory", "load_feature_tree_context", "move_card", "provide_artifact", "read_agent_conversation", "read_note", "read_specialist_spec_resource", "report_to_parent", "request_artifact", "request_previous_lane_handoff", "save_feature_retrospective_memory", "save_history_memory_context", "save_reasoning_memory", "search_cards", "search_reasoning_memories", "send_message_to_agent", "send_message_to_task_agent", "set_agent_name", "set_note_content", "set_workspace_title", "submit_lane_handoff", "subscribe_to_events", "summarize_file_session_context", "summarize_task_history_context", "unsubscribe_from_events", "update_card", "update_task", "update_task_status", "wake_or_create_task_agent"],
  "kanban-planning": ["assemble_task_adaptive_harness", "capture_screenshot", "confirm_feature_tree_story_context", "create_card", "create_note", "decompose_tasks", "get_artifact", "inspect_transcript_turns", "list_artifacts", "list_cards_by_column", "load_feature_retrospective_memory", "load_feature_tree_context", "move_card", "provide_artifact", "save_feature_retrospective_memory", "save_history_memory_context", "save_reasoning_memory", "search_cards", "search_reasoning_memories", "summarize_file_session_context", "summarize_task_history_context", "update_card", "update_task"],
  "team-coordination": ["assemble_task_adaptive_harness", "capture_screenshot", "confirm_feature_tree_story_context", "convert_task_blocks", "create_note", "create_task", "delegate_task", "delegate_task_to_agent", "get_artifact", "inspect_transcript_turns", "list_agents", "list_artifacts", "list_notes", "list_pending_artifact_requests", "load_feature_retrospective_memory", "load_feature_tree_context", "move_card", "provide_artifact", "read_agent_conversation", "read_note", "report_to_parent", "request_artifact", "request_previous_lane_handoff", "save_feature_retrospective_memory", "save_history_memory_context", "save_reasoning_memory", "search_reasoning_memories", "send_message_to_agent", "set_agent_name", "set_note_content", "submit_lane_handoff", "summarize_file_session_context", "summarize_task_history_context", "update_card", "update_task"],
};
const BASELINE_DEFINITION_HASHES = {
  essential: "5c1613226fdfae965dc4d766a4c3dd45b917ce560d6f3a44ec354a3892f52859",
  full: "bce3011196c07c262912fe7c254285054a151aea1cbc5be4cadb840e37950940",
  "kanban-planning": "a4b6477ea43abb7d91030ec5999d916fba45186775d5d9e239b494259dd97c32",
  "team-coordination": "d16b1704f2f499271544dd1198fb3a9bd6d293c9502d0eb7e384c54a5db900f1",
};
const BASELINE_ESSENTIAL_DEFINITION_BYTES = 30467;

type Variant = { label: keyof typeof BASELINE; mode: ToolMode; profile?: McpServerProfile };
const VARIANTS: Variant[] = [
  { label: "essential", mode: "essential" },
  { label: "full", mode: "full" },
  { label: "kanban-planning", mode: "full", profile: "kanban-planning" },
  { label: "team-coordination", mode: "full", profile: "team-coordination" },
];

async function createFixture() {
  const taskStore = new InMemoryTaskStore();
  const boardStore = new InMemoryKanbanBoardStore();
  await boardStore.save(createKanbanBoard({ id: "board-1", workspaceId: "default", name: "Board", isDefault: true }));
  await taskStore.save(buildFixedCard());
  const tools = new AgentTools(new InMemoryAgentStore(), new InMemoryConversationStore(), taskStore, new EventBus());
  tools.setKanbanBoardStore(boardStore);
  return { tools, kanbanTools: new KanbanTools(boardStore, taskStore) };
}

function createServerRecorder() {
  const registrations = new Map<string, {
    schema: z.ZodRawShape;
    handler: (params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
  }>();
  return {
    registrations,
    server: {
      tool(name: string, _description: string, schema: z.ZodRawShape, handler: never) {
        registrations.set(name, { schema, handler });
      },
    },
  };
}

function buildManager(tools: AgentTools, kanbanTools: KanbanTools | undefined, variant: Variant) {
  const manager = new RoutaMcpToolManager(tools, "default");
  manager.setToolMode(variant.mode);
  manager.setMcpProfile(variant.profile);
  manager.setAllowedTools(getMcpProfileToolAllowlist(variant.profile));
  if (kanbanTools) manager.setKanbanTools(kanbanTools);
  const { registrations, server } = createServerRecorder();
  manager.registerTools(server as never);
  return { manager, registrations };
}

/** Mirrors the MCP SDK: params go through the registered zod shape first. */
async function callRegistered(registrations: ReturnType<typeof createServerRecorder>["registrations"], args: Record<string, unknown>) {
  const tool = registrations.get("get_task");
  expect(tool, "get_task must be registered").toBeDefined();
  const result = await tool!.handler(z.object(tool!.schema).parse(args));
  return { isError: result.isError, payload: JSON.parse(result.content[0]!.text) as Record<string, unknown> };
}

function expectFixedCard(payload: Record<string, unknown>) {
  expect(payload.id).toBe("task-fixed");
  expect((payload.comments as Array<{ id: string }>).map((comment) => comment.id)).toEqual(["c1", "c2", "c3"]);
  expect(payload.verificationVerdict).toBe("NOT_APPROVED");
}

const sortedNames = (variant: Variant) => getMcpToolDefinitions(variant.mode, variant.profile).map((tool) => tool.name).sort();

describe("get_task reaches every TS entry point (AC1, F4)", () => {
  it.each(VARIANTS)("RoutaMcpToolManager $label registers get_task and it returns the card", async (variant) => {
    const { tools, kanbanTools } = await createFixture();
    const { manager, registrations } = buildManager(tools, kanbanTools, variant);
    manager.setSessionId("s-unrelated");
    const { isError, payload } = await callRegistered(registrations, { taskId: "task-fixed" });
    expect(isError).toBe(false);
    expectFixedCard(payload);
  });

  it.each(VARIANTS)("RoutaMcpToolManager $label finds the bound card without taskId when the session is set after registration", async (variant) => {
    const { tools, kanbanTools } = await createFixture();
    const { manager, registrations } = buildManager(tools, kanbanTools, variant);
    manager.setSessionId("s-trigger");
    const { isError, payload } = await callRegistered(registrations, {});
    expect(isError).toBe(false);
    expectFixedCard(payload);
  });

  it.each(VARIANTS)("getMcpToolDefinitions $label lists get_task and executeMcpTool runs it", async (variant) => {
    expect(sortedNames(variant)).toContain("get_task");
    const { tools, kanbanTools } = await createFixture();
    const byId = await executeMcpTool(tools, "get_task", { workspaceId: "default", taskId: "task-fixed" }, undefined, undefined, kanbanTools, variant.profile);
    expect(byId.isError).toBe(false);
    expectFixedCard(JSON.parse(byId.content[0]!.text));
    const bySession = await executeMcpTool(tools, "get_task", { workspaceId: "default", sessionId: "s-dev" }, undefined, undefined, kanbanTools, variant.profile);
    expect(bySession.isError).toBe(false);
    expectFixedCard(JSON.parse(bySession.content[0]!.text));
  });

  it("C12: returns 'Kanban tools not available.' when the manager has no kanban tools", async () => {
    const { tools } = await createFixture();
    const { registrations } = buildManager(tools, undefined, VARIANTS[1]!);
    const { isError, payload } = await callRegistered(registrations, { taskId: "task-fixed" });
    expect(isError).toBe(true);
    expect(payload.error).toBe("Kanban tools not available.");
  });
});

describe("existing tool surface is unchanged apart from get_task (F2 ① ②)", () => {
  it.each(VARIANTS)("$label names = baseline + get_task, other definitions byte-identical", (variant) => {
    expect(sortedNames(variant)).toEqual([...BASELINE[variant.label], "get_task"].sort());
    const others = getMcpToolDefinitions(variant.mode, variant.profile).filter((tool) => tool.name !== "get_task");
    const hash = crypto.createHash("sha256").update(JSON.stringify(others)).digest("hex");
    expect(hash).toBe(BASELINE_DEFINITION_HASHES[variant.label]);
  });
});

describe("get_task description (C10)", () => {
  it("is 2-3 sentences, says read-only / omit taskId, names the full-text params, and adds <= 1500 bytes to essential", () => {
    const { description, inputSchema } = GET_TASK_TOOL_DEFINITION;
    const sentences = description.split(/(?<=[.!?])\s+/).filter(Boolean);
    expect(sentences.length).toBeGreaterThanOrEqual(2);
    expect(sentences.length).toBeLessThanOrEqual(3);
    expect(description).toMatch(/read-only/i);
    expect(description).toContain("Omit taskId");
    for (const param of ["commentLimit", "maxCommentChars"]) {
      expect(description).toContain(param);
      expect(Object.keys(inputSchema.properties)).toContain(param);
    }
    const essentialBytes = Buffer.byteLength(JSON.stringify(getMcpToolDefinitions("essential")), "utf8");
    expect(essentialBytes - BASELINE_ESSENTIAL_DEFINITION_BYTES).toBeLessThanOrEqual(1500);
  });
});
