// @vitest-environment node
import { describe, expect, it } from "vitest";

import { createTask } from "../../models/task";
import { InMemoryKanbanBoardStore } from "../../store/kanban-board-store";
import { InMemoryTaskStore } from "../../store/task-store";
import { isCompletionReportNote } from "../../kanban/completion-report";
import { KanbanTools } from "../kanban-tools";

async function setup() {
  const boardStore = new InMemoryKanbanBoardStore();
  const taskStore = new InMemoryTaskStore();
  const tools = new KanbanTools(boardStore, taskStore);
  const task = createTask({
    id: "task-report",
    title: "Completion report dedupe",
    objective: "Only one completion report per card",
    workspaceId: "default",
    columnId: "done",
  });
  await taskStore.save(task);
  return { tools, taskStore, taskId: task.id };
}

describe("KanbanTools.updateCard completion report dedupe", () => {
  it("keeps a single 「## 完成汇报」 note and updates it with the latest report", async () => {
    const { tools, taskStore, taskId } = await setup();

    await tools.updateCard({ cardId: taskId, comment: "## 完成汇报\n第一次汇报", sessionId: "reporter-1" });
    const firstId = (await taskStore.get(taskId))!.comments!.find((entry) => isCompletionReportNote(entry.body))!.id;

    await tools.updateCard({ cardId: taskId, comment: "## 完成汇报\n第二次汇报", sessionId: "reporter-2" });

    const comments = (await taskStore.get(taskId))!.comments ?? [];
    const reports = comments.filter((entry) => isCompletionReportNote(entry.body));
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ id: firstId, body: "## 完成汇报\n第二次汇报", sessionId: "reporter-2" });
  });

  it("treats an English 「## Completion Summary」 note as the same report", async () => {
    const { tools, taskStore, taskId } = await setup();

    await tools.updateCard({ cardId: taskId, comment: "## 完成汇报\n中文汇报" });
    await tools.updateCard({ cardId: taskId, comment: "## Completion Summary\nEnglish summary" });

    const comments = (await taskStore.get(taskId))!.comments ?? [];
    const reports = comments.filter((entry) => isCompletionReportNote(entry.body));
    expect(reports).toHaveLength(1);
    expect(reports[0].body).toBe("## Completion Summary\nEnglish summary");
  });

  it("still appends ordinary notes next to an existing report", async () => {
    const { tools, taskStore, taskId } = await setup();

    await tools.updateCard({ cardId: taskId, comment: "## 完成汇报\n汇报" });
    await tools.updateCard({ cardId: taskId, comment: "## Dev Evidence\n进度一" });
    await tools.updateCard({ cardId: taskId, comment: "普通评论" });

    const comments = (await taskStore.get(taskId))!.comments ?? [];
    expect(comments.map((entry) => entry.body)).toEqual([
      "## 完成汇报\n汇报",
      "## Dev Evidence\n进度一",
      "普通评论",
    ]);
  });
});
