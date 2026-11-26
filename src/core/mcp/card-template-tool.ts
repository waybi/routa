import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { renderCardTemplate } from "../kanban/card-template";

export const GET_CARD_TEMPLATE_TOOL_NAME = "get_card_template";

/**
 * Read-only tool: return the canonical card body template so the dispatcher
 * fills a fixed skeleton instead of inventing a layout per card.
 */
export function registerGetCardTemplateTool(server: McpServer): void {
  server.tool(
    GET_CARD_TEMPLATE_TOOL_NAME,
    "Return the canonical card body template: 9 sections with length ranges, the fixed 7-column verification table header, and the global clauses copied into every card. Call it before create_card / create_task so the body only needs filling in.",
    {},
    async () => ({
      content: [{ type: "text" as const, text: renderCardTemplate() }],
    }),
  );
}
