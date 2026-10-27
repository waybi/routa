import type { KanbanBoardInfo, TaskInfo } from "../../types";
import { getBlockedResolverAutomation } from "../../kanban/blocked-resolver-automation";
import { HOUR, NOW, card, iso, run } from "./inbox-fixtures";

type Automation = KanbanBoardInfo["columns"][number]["automation"];

/** The four live boards' Blocked automation (steps + top-level mirror). */
export const RESOLVER_AUTOMATION = getBlockedResolverAutomation("zh-CN") as Automation;

/** Board whose Blocked lane (stage blocked, id `blockedId`) carries `automation`. */
export function resolverBoard(automation: Automation | undefined = RESOLVER_AUTOMATION, blockedId = "blocked", id = "b1"): KanbanBoardInfo {
  return {
    id,
    name: id,
    isDefault: true,
    autoProviderId: "dsh",
    columns: [
      { id: "dev", name: "Dev", position: 0, stage: "dev" },
      { id: "review", name: "Review", position: 1, stage: "review" },
      { id: "done", name: "Done", position: 2, stage: "done" },
      { id: blockedId, name: "Blocked", position: 3, stage: "blocked", ...(automation ? { automation } : {}) },
    ],
  } as unknown as KanbanBoardInfo;
}

/** Blocked card without lastSyncError (reason blockedUnknown). */
export function blockedCard(id: string, overrides: Partial<TaskInfo> = {}): TaskInfo {
  return card(id, { status: "PENDING", columnId: "blocked", updatedAt: iso(NOW - 2 * HOUR), ...overrides });
}

export function resolution(category: string, overrides: Record<string, unknown> = {}): TaskInfo["attentionResolution"] {
  return { category, conclusion: `conclusion ${category}`, ref: "abc1234", resolvedAt: iso(NOW - HOUR), ...overrides } as TaskInfo["attentionResolution"];
}

export function blockedRun(startedAt: number, status: "running" | "completed" | "failed", columnId = "blocked") {
  return run(columnId, startedAt, status);
}

export const RECORD_BODY = "## 自动处理记录\n\n### 卡在哪\nattention:blocked\n\n### 判断\n…";

export function comment(id: string, body: string, createdAt: string) {
  return { id, body, createdAt };
}
