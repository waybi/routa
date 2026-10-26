/**
 * "Needs your attention" rules for the current board. The judgement lives in
 * src/core/kanban/attention-rules.ts (card 64f2e31c) so the server-side
 * settlement that routes cards to Blocked uses the very same functions; this
 * module re-exports it for the board strip, the inbox and the overview.
 */

import type { TaskInfo } from "../types";

export {
  ATTENTION_DONE_WINDOW_MS,
  MAIN_PUSHER_SPECIALIST_ID,
  attentionDismissKey,
  boardHasMainPusher,
  collectAttentionItems,
  collectTaskAttentionItems,
  findInterruptedLaneSession,
  isTaskInterrupted,
  type KanbanAttentionItem,
  type KanbanAttentionKind,
} from "@/core/kanban/attention-rules";

export type TaskLaneSessionInfo = NonNullable<TaskInfo["laneSessions"]>[number];
