/**
 * @vitest-environment node
 *
 * taskToCard gains verificationVerdict (card ed9adb91, AC6). Imports only pre-existing modules so a
 * reverted implementation fails on assertions, not on imports.
 */
import { describe, expect, it } from "vitest";

import { createKanbanBoard } from "../../models/kanban";
import type { Task } from "../../models/task";
import { InMemoryKanbanBoardStore } from "../../store/kanban-board-store";
import { InMemoryTaskStore } from "../../store/task-store";
import { KanbanTools } from "../kanban-tools";
import { BASELINE_CARD_KEYS, buildFixedCard } from "./get-task-fixtures";

async function setupCards(tasks: Task[]) {
  const boardStore = new InMemoryKanbanBoardStore();
  await boardStore.save(createKanbanBoard({ id: "board-1", workspaceId: "default", name: "Board", isDefault: true }));
  const taskStore = new InMemoryTaskStore();
  for (const task of tasks) await taskStore.save(task);
  return { kanbanTools: new KanbanTools(boardStore, taskStore) };
}

describe("taskToCard.verificationVerdict (C5, AC6, F2 ④)", () => {
  async function cardsSetup() {
    const withVerdict = buildFixedCard({ id: "v1", title: "Verdict card", columnId: "dev" });
    const withoutVerdict = buildFixedCard({ id: "v2", title: "Verdict-less card", columnId: "dev", verificationVerdict: undefined });
    return setupCards([withVerdict, withoutVerdict]);
  }

  it.each([
    ["search_cards", (tools: KanbanTools) => tools.searchCards({ query: "card", workspaceId: "default" })],
    ["list_cards_by_column", async (tools: KanbanTools) => {
      const result = await tools.listCardsByColumn("dev", "board-1", "default");
      return { ...result, data: (result.data as { cards: unknown[] }).cards };
    }],
  ])("%s returns verificationVerdict and nothing else new", async (_name, call) => {
    const { kanbanTools } = await cardsSetup();
    const result = await call(kanbanTools);
    expect(result.success).toBe(true);
    const cards = result.data as Array<Record<string, unknown>>;
    const byId = new Map(cards.map((card) => [card.id, card]));
    expect(byId.get("v1")?.verificationVerdict).toBe("NOT_APPROVED");
    expect(byId.get("v2")?.verificationVerdict ?? null).toBeNull();
    for (const card of cards) {
      expect(Object.keys(card).sort()).toEqual([...BASELINE_CARD_KEYS, "verificationVerdict"].sort());
      expect(card).not.toHaveProperty("verificationReport");
      expect(card).not.toHaveProperty("laneSessions");
    }
    // F2 ④: dropping verificationVerdict gives back exactly the baseline projection.
    const { verificationVerdict: _verdict, ...rest } = byId.get("v1")!;
    const source = buildFixedCard({ id: "v1", title: "Verdict card", columnId: "dev" });
    expect(rest).toEqual({
      id: source.id, title: source.title, description: source.objective, comment: source.comment,
      comments: source.comments, status: source.status, columnId: source.columnId, position: source.position,
      priority: source.priority, labels: source.labels, assignee: source.assignee,
      contextSearchSpec: source.contextSearchSpec, createdAt: source.createdAt, updatedAt: source.updatedAt,
    });
  });
});
