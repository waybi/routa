/**
 * Pure data helpers for the team page: coordinator selection and linking,
 * run-record sorting and display fields. No React, no fetching.
 */
import type { SessionInfo } from "../types";

export const TEAM_LEAD_SPECIALIST_ID = "team-agent-lead";

export interface TeamRunSessionInfo extends SessionInfo {
  descendants?: number;
  directDelegates?: number;
}

export interface CoordinatorAgent {
  id: string;
  name: string;
  role: string;
  status?: string;
  createdAt: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
}

export type SortDirection = "desc" | "asc";

/** GET /api/agents returns `{ agents: [...] }` (not `sessions`). */
export function pickAgents(data: unknown): CoordinatorAgent[] {
  const agents = (data as { agents?: unknown } | null)?.agents;
  return Array.isArray(agents) ? (agents as CoordinatorAgent[]) : [];
}

function timeOf(value?: string): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}

function compareIds(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Sorts by createdAt in the given direction; equal times fall back to session ID ascending. */
export function sortTeamRuns<T extends { sessionId: string; createdAt: string }>(runs: T[], direction: SortDirection): T[] {
  const sign = direction === "desc" ? -1 : 1;
  return [...runs].sort((a, b) => {
    const diff = timeOf(a.createdAt) - timeOf(b.createdAt);
    if (diff !== 0) return diff * sign;
    return compareIds(a.sessionId, b.sessionId);
  });
}

/** ROUTA agents only, newest first (equal times by ID ascending). */
export function selectCoordinators(agents: CoordinatorAgent[]): CoordinatorAgent[] {
  return agents
    .filter((agent) => (agent.role ?? "").toUpperCase() === "ROUTA")
    .sort((a, b) => {
      const diff = timeOf(b.createdAt) - timeOf(a.createdAt);
      if (diff !== 0) return diff;
      return compareIds(a.id, b.id);
    });
}

/**
 * The session a coordinator belongs to: `session.routaAgentId === agent.id`,
 * looked up in the team runs first, then in every workspace session.
 * Returns undefined when nothing links to it; never guesses from names.
 */
export function findCoordinatorSession<T extends Pick<SessionInfo, "sessionId" | "routaAgentId">>(
  agentId: string,
  teamRuns: T[],
  allSessions: T[],
): T | undefined {
  return teamRuns.find((run) => run.routaAgentId === agentId)
    ?? allSessions.find((session) => session.routaAgentId === agentId);
}

/** Last path segment of cwd plus branch; null when neither is recorded. */
export function repoBranchParts(run: Pick<SessionInfo, "cwd" | "branch">): { repo?: string; branch?: string } | null {
  const repo = run.cwd ? run.cwd.replace(/\/+$/, "").split("/").pop() || undefined : undefined;
  const branch = run.branch || undefined;
  if (!repo && !branch) return null;
  return { repo, branch };
}

export function displayLabelOf(agent: CoordinatorAgent): string | undefined {
  const value = agent.metadata?.displayLabel;
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function avatarLetter(name: string): string {
  return (name.trim().charAt(0) || "?").toUpperCase();
}

// ---- Team page v2 (redesign card 14) ----

const LIVE_ACP_STATUSES = new Set(["connecting", "ready"]);

/** Header stat rule (unchanged from the legacy page): acpStatus is connecting or ready, terminal state ignored. */
export function isLiveAcpStatus(status?: string | null): boolean {
  return LIVE_ACP_STATUSES.has(status ?? "");
}

/** Per specialist id: sessions whose acpStatus is connecting/ready. Sessions without specialistId are skipped. */
export function countActiveSessionsBySpecialist(sessions: Array<{ specialistId?: string; acpStatus?: string | null }>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    if (!session.specialistId || !isLiveAcpStatus(session.acpStatus)) continue;
    counts.set(session.specialistId, (counts.get(session.specialistId) ?? 0) + 1);
  }
  return counts;
}

export type RunFilter = "all" | "active" | "ended" | "error";
export const RUN_FILTERS: readonly RunFilter[] = ["all", "active", "ended", "error"];

/**
 * Status filter bucket, terminal state first (same priority as runStatusLabel):
 * failed / timed_out → error; completed → ended; no terminal state: acpStatus
 * error → error, connecting/ready → active. Anything else only counts in "all".
 */
export function runFilterBucket(run: { terminalState?: string | null; acpStatus?: string | null }): Exclude<RunFilter, "all"> | null {
  if (run.terminalState) {
    if (run.terminalState === "failed" || run.terminalState === "timed_out") return "error";
    if (run.terminalState === "completed") return "ended";
    return null;
  }
  if (run.acpStatus === "error") return "error";
  if (isLiveAcpStatus(run.acpStatus)) return "active";
  return null;
}

export function matchesRunFilter(run: { terminalState?: string | null; acpStatus?: string | null }, filter: RunFilter): boolean {
  return filter === "all" || runFilterBucket(run) === filter;
}

export function countRunFilters(runs: Array<{ terminalState?: string | null; acpStatus?: string | null }>): Record<RunFilter, number> {
  const counts: Record<RunFilter, number> = { all: runs.length, active: 0, ended: 0, error: 0 };
  for (const run of runs) {
    const bucket = runFilterBucket(run);
    if (bucket) counts[bucket] += 1;
  }
  return counts;
}

export type RoleGroupKey = "ROUTA" | "CRAFTER" | "GATE" | "DEVELOPER" | "OTHER";
export const ROLE_GROUP_KEYS: readonly RoleGroupKey[] = ["ROUTA", "CRAFTER", "GATE", "DEVELOPER", "OTHER"];

export function roleGroupOf(role?: string | null): RoleGroupKey {
  const upper = (role ?? "").trim().toUpperCase();
  return upper === "ROUTA" || upper === "CRAFTER" || upper === "GATE" || upper === "DEVELOPER" ? upper : "OTHER";
}

/**
 * Splits team specialists (already in display order) into the lead and role
 * columns. The lead never enters a column; "OTHER" is only returned when it has members.
 */
export function groupSpecialistsByRole<T extends { id: string; role?: string }>(specialists: T[]): {
  lead: T | undefined;
  groups: Array<{ key: RoleGroupKey; members: T[] }>;
} {
  const lead = specialists.find((specialist) => specialist.id === TEAM_LEAD_SPECIALIST_ID);
  const buckets = new Map<RoleGroupKey, T[]>(ROLE_GROUP_KEYS.map((key) => [key, []]));
  for (const specialist of specialists) {
    if (specialist.id === TEAM_LEAD_SPECIALIST_ID) continue;
    buckets.get(roleGroupOf(specialist.role))!.push(specialist);
  }
  const groups = ROLE_GROUP_KEYS
    .filter((key) => key !== "OTHER" || buckets.get("OTHER")!.length > 0)
    .map((key) => ({ key, members: buckets.get(key)! }));
  return { lead, groups };
}

/**
 * Runs a specialist took part in: its sessions newest first, each pointing at
 * `parentSessionId ?? sessionId`, de-duplicated by that target, at most `limit`.
 */
export function recentRunsForSpecialist<T extends Pick<SessionInfo, "sessionId" | "specialistId" | "parentSessionId" | "createdAt">>(
  sessions: T[],
  specialistId: string,
  limit = 5,
): Array<{ targetId: string; session: T }> {
  const mine = sessions
    .filter((session) => session.specialistId === specialistId)
    .sort((a, b) => {
      const diff = timeOf(b.createdAt) - timeOf(a.createdAt);
      if (diff !== 0) return diff;
      return compareIds(a.sessionId, b.sessionId);
    });
  const seen = new Set<string>();
  const out: Array<{ targetId: string; session: T }> = [];
  for (const session of mine) {
    const targetId = session.parentSessionId || session.sessionId;
    if (seen.has(targetId)) continue;
    seen.add(targetId);
    out.push({ targetId, session });
    if (out.length >= limit) break;
  }
  return out;
}

/** Distinct specialist ids of the child sessions of `runId`, in first-seen order. */
export function memberSpecialistsOfRun(
  runId: string,
  sessions: Array<Pick<SessionInfo, "parentSessionId" | "specialistId">>,
): string[] {
  const ids: string[] = [];
  for (const session of sessions) {
    if (session.parentSessionId !== runId || !session.specialistId) continue;
    if (!ids.includes(session.specialistId)) ids.push(session.specialistId);
  }
  return ids;
}
