import type {
  KanbanDevSessionCompletionRequirement,
  KanbanDevSessionSupervision,
  KanbanDevSessionSupervisionMode,
  KanbanLaneSessionWatchdog,
} from "../models/kanban";

const DEFAULT_KANBAN_DEV_SESSION_SUPERVISION: KanbanDevSessionSupervision = {
  mode: "watchdog_retry",
  inactivityTimeoutMinutes: 10,
  maxRecoveryAttempts: 1,
  completionRequirement: "turn_complete",
};

const VALID_MODES = new Set<KanbanDevSessionSupervisionMode>([
  "disabled",
  "watchdog_retry",
  "ralph_loop",
]);

const VALID_COMPLETION_REQUIREMENTS = new Set<KanbanDevSessionCompletionRequirement>([
  "turn_complete",
  "completion_summary",
  "verification_report",
]);

function metadataKey(boardId: string): string {
  return `kanbanDevSessionSupervision:${boardId}`;
}

function normalizeMode(value: unknown): KanbanDevSessionSupervisionMode {
  return VALID_MODES.has(value as KanbanDevSessionSupervisionMode)
    ? value as KanbanDevSessionSupervisionMode
    : DEFAULT_KANBAN_DEV_SESSION_SUPERVISION.mode;
}

function normalizeCompletionRequirement(value: unknown): KanbanDevSessionCompletionRequirement {
  return VALID_COMPLETION_REQUIREMENTS.has(value as KanbanDevSessionCompletionRequirement)
    ? value as KanbanDevSessionCompletionRequirement
    : DEFAULT_KANBAN_DEV_SESSION_SUPERVISION.completionRequirement;
}

function normalizeMinutes(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_KANBAN_DEV_SESSION_SUPERVISION.inactivityTimeoutMinutes;
  }
  return Math.min(120, Math.max(1, Math.floor(parsed)));
}

function normalizeAttempts(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_KANBAN_DEV_SESSION_SUPERVISION.maxRecoveryAttempts;
  }
  return Math.min(10, Math.max(0, Math.floor(parsed)));
}

export function normalizeKanbanDevSessionSupervision(
  config: Partial<KanbanDevSessionSupervision> | undefined,
): KanbanDevSessionSupervision {
  return {
    mode: normalizeMode(config?.mode),
    inactivityTimeoutMinutes: normalizeMinutes(config?.inactivityTimeoutMinutes),
    maxRecoveryAttempts: normalizeAttempts(config?.maxRecoveryAttempts),
    completionRequirement: normalizeCompletionRequirement(config?.completionRequirement),
  };
}

export function getKanbanDevSessionSupervision(
  metadata: Record<string, string> | undefined,
  boardId: string,
): KanbanDevSessionSupervision {
  const raw = metadata?.[metadataKey(boardId)];
  if (!raw) {
    return { ...DEFAULT_KANBAN_DEV_SESSION_SUPERVISION };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<KanbanDevSessionSupervision>;
    return normalizeKanbanDevSessionSupervision(parsed);
  } catch {
    return { ...DEFAULT_KANBAN_DEV_SESSION_SUPERVISION };
  }
}

export function setKanbanDevSessionSupervision(
  metadata: Record<string, string> | undefined,
  boardId: string,
  config: Partial<KanbanDevSessionSupervision> | undefined,
): Record<string, string> {
  const normalized = normalizeKanbanDevSessionSupervision(config);
  return {
    ...(metadata ?? {}),
    [metadataKey(boardId)]: JSON.stringify(normalized),
  };
}

export function getDefaultKanbanDevSessionSupervision(): KanbanDevSessionSupervision {
  return { ...DEFAULT_KANBAN_DEV_SESSION_SUPERVISION };
}

/**
 * Steps outside Dev: 20 minutes. In routa.db (2026-10-23) no completed
 * non-Dev step went quiet longer than 600.5s: DSH ends a single tool wait at
 * 10 minutes, so a long test run shows up as one 10-minute gap. Twice that
 * keeps normal steps safe and still frees a hung step's board slot within
 * half an hour (the hung Done steps had been silent for 2-7 hours).
 */
const DEFAULT_KANBAN_LANE_SESSION_WATCHDOG: KanbanLaneSessionWatchdog = {
  enabled: true,
  inactivityTimeoutMinutes: 20,
};

function laneWatchdogMetadataKey(boardId: string): string {
  return `kanbanLaneSessionWatchdog:${boardId}`;
}

export function normalizeKanbanLaneSessionWatchdog(
  config: Partial<KanbanLaneSessionWatchdog> | undefined,
): KanbanLaneSessionWatchdog {
  const parsed = typeof config?.inactivityTimeoutMinutes === "number"
    ? config.inactivityTimeoutMinutes
    : Number.parseInt(String(config?.inactivityTimeoutMinutes ?? ""), 10);
  return {
    enabled: typeof config?.enabled === "boolean" ? config.enabled : DEFAULT_KANBAN_LANE_SESSION_WATCHDOG.enabled,
    inactivityTimeoutMinutes: Number.isFinite(parsed)
      ? Math.min(240, Math.max(1, Math.floor(parsed)))
      : DEFAULT_KANBAN_LANE_SESSION_WATCHDOG.inactivityTimeoutMinutes,
  };
}

/** Board override: workspace metadata `kanbanLaneSessionWatchdog:<boardId>` holds the JSON. */
export function getKanbanLaneSessionWatchdog(
  metadata: Record<string, string> | undefined,
  boardId: string,
): KanbanLaneSessionWatchdog {
  const raw = metadata?.[laneWatchdogMetadataKey(boardId)];
  if (!raw) {
    return { ...DEFAULT_KANBAN_LANE_SESSION_WATCHDOG };
  }
  try {
    return normalizeKanbanLaneSessionWatchdog(JSON.parse(raw) as Partial<KanbanLaneSessionWatchdog>);
  } catch {
    return { ...DEFAULT_KANBAN_LANE_SESSION_WATCHDOG };
  }
}

export function setKanbanLaneSessionWatchdog(
  metadata: Record<string, string> | undefined,
  boardId: string,
  config: Partial<KanbanLaneSessionWatchdog> | undefined,
): Record<string, string> {
  return {
    ...(metadata ?? {}),
    [laneWatchdogMetadataKey(boardId)]: JSON.stringify(normalizeKanbanLaneSessionWatchdog(config)),
  };
}

export function getDefaultKanbanLaneSessionWatchdog(): KanbanLaneSessionWatchdog {
  return { ...DEFAULT_KANBAN_LANE_SESSION_WATCHDOG };
}
