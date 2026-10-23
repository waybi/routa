import { AgentEvent, AgentEventType, EventBus } from "../events/event-bus";
import type { TaskStore } from "../store/task-store";

export interface KanbanSessionQueueJob {
  cardId: string;
  cardTitle: string;
  boardId: string;
  workspaceId: string;
  columnId?: string;
  start: () => Promise<{ sessionId?: string | null; error?: string }>;
}

export interface KanbanBoardQueueSnapshot {
  boardId: string;
  runningCount: number;
  runningCards: Array<{ cardId: string; cardTitle: string }>;
  queuedCount: number;
  queuedCardIds: string[];
  queuedCards: Array<{ cardId: string; cardTitle: string }>;
  queuedPositions: Record<string, number>;
}

interface QueueEntry extends KanbanSessionQueueJob {
  status: "queued" | "running";
  enqueuedAt: Date;
  sessionId?: string;
  startError?: string;
}

export class KanbanSessionQueue {
  private handlerKey = "kanban-session-queue";
  private started = false;
  private jobsByCardId = new Map<string, QueueEntry>();
  private queuedByBoard = new Map<string, QueueEntry[]>();

  constructor(
    private eventBus: EventBus,
    private taskStore: TaskStore,
    private getConcurrencyLimit: (workspaceId: string, boardId: string) => Promise<number>,
  ) {}

  isCompatible(eventBus: EventBus, taskStore: TaskStore): boolean {
    return this.eventBus === eventBus && this.taskStore === taskStore;
  }

  /** Remove a card's job entry (used when auto-advancing to prevent stale entries) */
  removeCardJob(cardId: string): void {
    const entry = this.jobsByCardId.get(cardId);
    if (entry) {
      this.removeQueuedEntry(entry.boardId, cardId);
      this.jobsByCardId.delete(cardId);
    }
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.eventBus.on(this.handlerKey, (event: AgentEvent) => {
      if (
        event.type === AgentEventType.AGENT_COMPLETED ||
        event.type === AgentEventType.REPORT_SUBMITTED ||
        event.type === AgentEventType.AGENT_FAILED ||
        event.type === AgentEventType.AGENT_TIMEOUT
      ) {
        void this.handleAgentLifecycleEvent(event);
      }
    });
    this.started = true;
  }

  stop(): void {
    this.eventBus.off(this.handlerKey);
    this.started = false;
    this.jobsByCardId.clear();
    this.queuedByBoard.clear();
  }

  async enqueue(job: KanbanSessionQueueJob): Promise<{ sessionId?: string; queued: boolean; error?: string }> {
    await this.reconcileBoardEntries(job.boardId);

    const existing = this.jobsByCardId.get(job.cardId);
    if (existing?.status === "running") {
      // Check if the task's triggerSessionId was already cleared (e.g. by auto-advance).
      // If so, the old running entry is stale and should be replaced.
      const task = await this.taskStore.get(job.cardId);
      if (task && !task.triggerSessionId) {
        this.jobsByCardId.delete(job.cardId);
      } else {
        return { sessionId: existing.sessionId, queued: false };
      }
    }
    if (existing?.status === "queued") {
      if (this.isInBoardQueue(existing)) {
        return { queued: true };
      }
      // A queued job that no board queue holds would never be drained; replace it.
      this.jobsByCardId.delete(job.cardId);
    }

    const limit = await this.getConcurrencyLimit(job.workspaceId, job.boardId);
    const runningCount = this.countRunning(job.boardId);
    const entry: QueueEntry = {
      ...job,
      status: "queued",
      enqueuedAt: new Date(),
    };
    this.jobsByCardId.set(job.cardId, entry);

    if (runningCount >= limit) {
      this.pushQueuedEntry(entry);
      return { queued: true };
    }

    if ((this.queuedByBoard.get(job.boardId)?.length ?? 0) > 0) {
      // Cards that queued earlier get the free slot first; the newcomer waits its turn.
      this.pushQueuedEntry(entry);
      await this.drainQueue(job.boardId, job.workspaceId);
      if (this.jobsByCardId.get(job.cardId) === entry && entry.status === "running" && entry.sessionId) {
        return { sessionId: entry.sessionId, queued: false };
      }
      if (this.jobsByCardId.get(job.cardId) === entry) {
        return { queued: true };
      }
      return { queued: false, error: entry.startError ?? "Failed to start ACP session." };
    }

    return this.startEntry(entry);
  }

  async getBoardSnapshot(boardId: string): Promise<KanbanBoardQueueSnapshot> {
    await this.reconcileBoardEntries(boardId);

    const queuedEntries = this.queuedByBoard.get(boardId) ?? [];
    const queuedPositions = Object.fromEntries(
      queuedEntries.map((entry, index) => [entry.cardId, index + 1]),
    );

    return {
      boardId,
      runningCount: this.countRunning(boardId),
      runningCards: Array.from(this.jobsByCardId.values())
        .filter((entry) => entry.boardId === boardId && entry.status === "running")
        .map((entry) => ({ cardId: entry.cardId, cardTitle: entry.cardTitle })),
      queuedCount: queuedEntries.length,
      queuedCardIds: queuedEntries.map((entry) => entry.cardId),
      queuedCards: queuedEntries.map((entry) => ({ cardId: entry.cardId, cardTitle: entry.cardTitle })),
      queuedPositions,
    };
  }

  private async reconcileBoardEntries(boardId: string): Promise<void> {
    await this.reconcileRunningEntries(boardId);
    await this.reconcileQueuedEntries(boardId);
  }

  private async reconcileRunningEntries(boardId: string): Promise<void> {
    const runningEntries = Array.from(this.jobsByCardId.values())
      .filter((entry) => entry.boardId === boardId && entry.status === "running");

    for (const entry of runningEntries) {
      const currentEntry = this.jobsByCardId.get(entry.cardId);
      if (currentEntry !== entry || currentEntry.status !== "running") {
        continue;
      }

      const task = await this.taskStore.get(entry.cardId);
      const isStale = !task
        || task.boardId !== boardId
        || (entry.columnId !== undefined && task.columnId !== entry.columnId);

      if (isStale) {
        this.jobsByCardId.delete(entry.cardId);
      }
    }
  }

  private async reconcileQueuedEntries(boardId: string): Promise<void> {
    this.dropQueuedOrphans(boardId);

    const queuedEntries = this.queuedByBoard.get(boardId);
    if (!queuedEntries || queuedEntries.length === 0) {
      return;
    }

    const nextEntries: QueueEntry[] = [];

    for (const entry of queuedEntries) {
      const currentEntry = this.jobsByCardId.get(entry.cardId);
      if (currentEntry !== entry || currentEntry.status !== "queued") {
        continue;
      }

      const task = await this.taskStore.get(entry.cardId);
      const isStale = !task
        || task.boardId !== boardId
        || Boolean(task.triggerSessionId)
        || (entry.columnId !== undefined && task.columnId !== entry.columnId);

      if (isStale) {
        this.jobsByCardId.delete(entry.cardId);
        continue;
      }

      nextEntries.push(entry);
    }

    if (nextEntries.length === 0) {
      this.queuedByBoard.delete(boardId);
      return;
    }

    this.queuedByBoard.set(boardId, nextEntries);
  }

  private isInBoardQueue(entry: QueueEntry): boolean {
    return (this.queuedByBoard.get(entry.boardId) ?? []).includes(entry);
  }

  /**
   * A queued job outside its board queue is never drained, and enqueue used to
   * answer "already queued" for it forever. Drop such orphans so the card can
   * be enqueued again; their start closures may carry an outdated step.
   */
  private dropQueuedOrphans(boardId: string): void {
    for (const [cardId, entry] of Array.from(this.jobsByCardId.entries())) {
      if (entry.boardId === boardId && entry.status === "queued" && !this.isInBoardQueue(entry)) {
        this.jobsByCardId.delete(cardId);
      }
    }
  }

  private countRunning(boardId: string): number {
    let runningCount = 0;
    for (const entry of this.jobsByCardId.values()) {
      if (entry.boardId === boardId && entry.status === "running") {
        runningCount += 1;
      }
    }
    return runningCount;
  }

  private pushQueuedEntry(entry: QueueEntry): void {
    const queue = this.queuedByBoard.get(entry.boardId) ?? [];
    queue.push(entry);
    this.queuedByBoard.set(entry.boardId, queue);
  }

  private removeQueuedEntry(boardId: string, cardId: string): void {
    const queue = this.queuedByBoard.get(boardId);
    if (!queue) return;
    const nextQueue = queue.filter((entry) => entry.cardId !== cardId);
    if (nextQueue.length === 0) {
      this.queuedByBoard.delete(boardId);
      return;
    }
    this.queuedByBoard.set(boardId, nextQueue);
  }

  private async startEntry(entry: QueueEntry): Promise<{ sessionId?: string; queued: boolean; error?: string }> {
    this.removeQueuedEntry(entry.boardId, entry.cardId);
    entry.status = "running";

    try {
      const result = await entry.start();
      if (result.sessionId) {
        entry.sessionId = result.sessionId;
        this.jobsByCardId.set(entry.cardId, entry);
        return { sessionId: result.sessionId, queued: false };
      }

      entry.startError = result.error ?? "Failed to start ACP session.";
      this.jobsByCardId.delete(entry.cardId);
      void this.drainQueue(entry.boardId, entry.workspaceId);
      return {
        queued: false,
        error: entry.startError,
      };
    } catch (error) {
      entry.startError = error instanceof Error ? error.message : String(error);
      this.jobsByCardId.delete(entry.cardId);
      void this.drainQueue(entry.boardId, entry.workspaceId);
      return {
        queued: false,
        error: entry.startError,
      };
    }
  }

  private async handleAgentLifecycleEvent(event: AgentEvent): Promise<void> {
    const sessionId = typeof event.data?.sessionId === "string" ? event.data.sessionId : undefined;
    if (!sessionId) return;

    for (const [cardId, entry] of this.jobsByCardId.entries()) {
      if (entry.status !== "running" || entry.sessionId !== sessionId) continue;
      this.jobsByCardId.delete(cardId);
      await this.drainQueue(entry.boardId, entry.workspaceId);
      return;
    }
  }

  private async drainQueue(boardId: string, workspaceId: string): Promise<void> {
    await this.reconcileBoardEntries(boardId);

    const limit = await this.getConcurrencyLimit(workspaceId, boardId);

    // Always read the live queue: enqueue may add entries while start() is
    // awaited, and a copy taken before the loop would drop them on write-back.
    while (this.countRunning(boardId) < limit) {
      const nextEntry = this.queuedByBoard.get(boardId)?.[0];
      if (!nextEntry) return;

      const task = await this.taskStore.get(nextEntry.cardId);
      if (this.jobsByCardId.get(nextEntry.cardId) !== nextEntry || nextEntry.status !== "queued") {
        // Replaced or already started by a concurrent drain; just unlink it.
        this.removeQueuedEntryInstance(boardId, nextEntry);
        continue;
      }
      if (!task || task.boardId !== boardId || (nextEntry.columnId && task.columnId !== nextEntry.columnId)) {
        this.removeQueuedEntryInstance(boardId, nextEntry);
        this.jobsByCardId.delete(nextEntry.cardId);
        continue;
      }
      if (this.countRunning(boardId) >= limit) return;

      await this.startEntry(nextEntry);
    }
  }

  private removeQueuedEntryInstance(boardId: string, entry: QueueEntry): void {
    const queue = this.queuedByBoard.get(boardId);
    if (!queue) return;
    const nextQueue = queue.filter((queued) => queued !== entry);
    if (nextQueue.length === 0) {
      this.queuedByBoard.delete(boardId);
      return;
    }
    this.queuedByBoard.set(boardId, nextQueue);
  }
}
