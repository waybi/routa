/**
 * MCP `get_task`: read-only card snapshot (comments, review verdict, lane step
 * summary). Registered by RoutaMcpToolManager (agent MCP sessions) and exposed
 * by mcp-tool-executor (POST /api/mcp/tools). The Rust twin lives in
 * `crates/routa-server/src/api/mcp_routes/tool_executor/get_task.rs`.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { KanbanTools } from "../tools/kanban-tools";
import type { ToolResult } from "../tools/tool-result";

export const GET_TASK_TOOL_NAME = "get_task";

const GET_TASK_DESCRIPTION =
  "Read-only: return one card with comments (oldest first), verificationVerdict/verificationReport, acceptanceCriteria, verificationCommands and a lane-step summary. Omit taskId to read the card bound to the current session. Replies stay under 32 KB by default (long texts carry truncated markers); pass commentLimit and maxCommentChars to get more text.";

export const GET_TASK_TOOL_DEFINITION = {
  name: GET_TASK_TOOL_NAME,
  description: GET_TASK_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      taskId: { type: "string", description: "Card/task ID (defaults to the card bound to the current session)" },
      commentLimit: { type: "number", description: "Return at most this many newest comments (default 20)" },
      maxCommentChars: { type: "number", description: "Characters kept per comment, objective and verificationReport (default 1500/1500/3000)" },
      sessionId: { type: "string", description: "Session used to find the bound card when taskId is omitted" },
      workspaceId: { type: "string", description: "Workspace ID (uses default if omitted)" },
    },
  },
};

interface TextMcpToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export async function executeGetTaskTool(
  kanbanTools: KanbanTools | undefined,
  args: Record<string, unknown>,
  workspaceId: string,
  boundSessionId?: string,
): Promise<ToolResult> {
  if (!kanbanTools) return { success: false, error: "Kanban tools not available." };
  return kanbanTools.getTask({
    taskId: optionalString(args.taskId),
    sessionId: boundSessionId ?? optionalString(args.sessionId),
    workspaceId: optionalString(args.workspaceId) ?? workspaceId,
    commentLimit: optionalNumber(args.commentLimit),
    maxCommentChars: optionalNumber(args.maxCommentChars),
  });
}

/**
 * `getSessionId` is read per call: RoutaMcpToolManager binds the session after
 * tools are registered.
 */
export function registerGetTaskTool(
  server: McpServer,
  getKanbanTools: () => KanbanTools | undefined,
  workspaceId: string,
  getSessionId: () => string | undefined,
  toMcpResult: (result: ToolResult) => TextMcpToolResult,
): void {
  server.tool(
    GET_TASK_TOOL_NAME,
    GET_TASK_DESCRIPTION,
    {
      taskId: z.string().optional().describe("Card/task ID (defaults to the card bound to the current session)"),
      commentLimit: z.number().optional().describe("Return at most this many newest comments (default 20)"),
      maxCommentChars: z.number().optional().describe("Characters kept per comment, objective and verificationReport (default 1500/1500/3000)"),
      sessionId: z.string().optional().describe("Session used to find the bound card when taskId is omitted"),
      workspaceId: z.string().optional().describe("Workspace ID (uses default if omitted)"),
    },
    async (params) => toMcpResult(await executeGetTaskTool(getKanbanTools(), params, workspaceId, getSessionId())),
  );
}
