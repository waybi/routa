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
