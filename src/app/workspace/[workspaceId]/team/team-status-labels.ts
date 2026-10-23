/**
 * Status and label copy for the team page and the team-session page.
 *
 * Zero-dependency contract: this module only depends on the dictionary type
 * and raw values. Both pages read status text from here; neither page is
 * imported by it. Unknown values return the "unknown" copy with `known: false`
 * so callers can put the raw value into a `title` attribute.
 */
import type { TeamRedesignTranslationDictionarySections } from "@/i18n/types-team-redesign";

export type TeamRedesignCopy = TeamRedesignTranslationDictionarySections["teamRedesign"];
export type StatusTone = "neutral" | "info" | "attention" | "danger" | "success";

export interface StatusLabel {
  label: string;
  tone: StatusTone;
  known: boolean;
  raw?: string;
}

export const AGENT_STATUSES = ["PENDING", "ACTIVE", "COMPLETED", "ERROR", "CANCELLED"] as const;
export const ACP_STATUSES = ["connecting", "ready", "error"] as const;
export const TERMINAL_STATES = ["completed", "failed", "timed_out"] as const;
export const MEMBER_STATUSES = ["idle", "working", "blocked", "reviewing", "done"] as const;
export const TASK_STATUSES = ["not-started", "in-progress", "waiting-review", "done", "blocked"] as const;
export const DELIVERABLE_STATUSES = ["draft", "review", "approved"] as const;
export const DELIVERABLE_LABELS = [
  "deliverable",
  "findings",
  "test report",
  "ui proposal",
  "patch",
  "spec draft",
  "work package",
  "team note",
] as const;
export const EVENT_TYPES = ["plan", "assign", "revision", "finding", "complete", "blocked"] as const;
export const LANE_LABEL_KEYS = ["update", "report-back", "user", "agent", "runtime", "tool"] as const;
export type LaneLabelKey = typeof LANE_LABEL_KEYS[number];

function unknown(copy: TeamRedesignCopy, raw?: string | null): StatusLabel {
  return { label: copy.status.unknown, tone: "neutral", known: false, raw: raw ?? undefined };
}

function known(label: string, tone: StatusTone, raw: string): StatusLabel {
  return { label, tone, known: true, raw };
}

export function agentStatusLabel(copy: TeamRedesignCopy, status?: string | null): StatusLabel {
  const s = copy.status.agent;
  switch ((status ?? "").toUpperCase()) {
    case "PENDING": return known(s.pending, "attention", status!);
    case "ACTIVE": return known(s.active, "info", status!);
    case "COMPLETED": return known(s.completed, "success", status!);
    case "ERROR": return known(s.error, "danger", status!);
    case "CANCELLED": return known(s.cancelled, "neutral", status!);
    default: return unknown(copy, status);
  }
}

export function acpStatusLabel(copy: TeamRedesignCopy, status?: string | null): StatusLabel {
  const s = copy.status.acp;
  switch (status) {
    case "connecting": return known(s.connecting, "attention", status);
    case "ready": return known(s.ready, "success", status);
    case "error": return known(s.error, "danger", status);
    default: return unknown(copy, status);
  }
}

export function terminalStateLabel(copy: TeamRedesignCopy, state?: string | null): StatusLabel {
  const s = copy.status.terminal;
  switch (state) {
    case "completed": return known(s.completed, "success", state);
    case "failed": return known(s.failed, "danger", state);
    case "timed_out": return known(s.timedOut, "attention", state);
    default: return unknown(copy, state);
  }
}

/**
 * Status of a team run row or a team session: terminal state wins, then the
 * ACP connection status; with neither the copy says "not recorded".
 */
export function runStatusLabel(
  copy: TeamRedesignCopy,
  run: { terminalState?: string | null; acpStatus?: string | null } | null | undefined,
): StatusLabel {
  if (run?.terminalState) return terminalStateLabel(copy, run.terminalState);
  if (run?.acpStatus) return acpStatusLabel(copy, run.acpStatus);
  return { label: copy.common.notRecorded, tone: "neutral", known: false };
}

export function memberStatusLabel(copy: TeamRedesignCopy, status?: string | null): StatusLabel {
  const s = copy.status.member;
  switch (status) {
    case "idle": return known(s.idle, "neutral", status);
    case "working": return known(s.working, "info", status);
    case "blocked": return known(s.blocked, "danger", status);
    case "reviewing": return known(s.reviewing, "attention", status);
    case "done": return known(s.done, "success", status);
    default: return unknown(copy, status);
  }
}

export function taskStatusLabel(copy: TeamRedesignCopy, status?: string | null): StatusLabel {
  const s = copy.status.task;
  switch (status) {
    case "not-started": return known(s.notStarted, "neutral", status);
    case "in-progress": return known(s.inProgress, "info", status);
    case "waiting-review": return known(s.waitingReview, "attention", status);
    case "done": return known(s.done, "success", status);
    case "blocked": return known(s.blocked, "danger", status);
    default: return unknown(copy, status);
  }
}

export function deliverableStatusLabel(copy: TeamRedesignCopy, status?: string | null): StatusLabel {
  const s = copy.status.deliverable;
  switch (status) {
    case "draft": return known(s.draft, "neutral", status);
    case "review": return known(s.review, "attention", status);
    case "approved": return known(s.approved, "success", status);
    default: return unknown(copy, status);
  }
}

export function deliverableKindLabel(copy: TeamRedesignCopy, kind?: string | null): StatusLabel {
  const s = copy.status.deliverableLabel;
  switch (kind) {
    case "deliverable": return known(s.deliverable, "neutral", kind);
    case "findings": return known(s.findings, "info", kind);
    case "test report": return known(s.testReport, "info", kind);
    case "ui proposal": return known(s.uiProposal, "info", kind);
    case "patch": return known(s.patch, "info", kind);
    case "spec draft": return known(s.specDraft, "neutral", kind);
    case "work package": return known(s.workPackage, "neutral", kind);
    case "team note": return known(s.teamNote, "neutral", kind);
    default: return unknown(copy, kind);
  }
}

export function eventTypeLabel(copy: TeamRedesignCopy, type?: string | null): StatusLabel {
  const s = copy.status.eventType;
  switch (type) {
    case "plan": return known(s.plan, "neutral", type);
    case "assign": return known(s.assign, "info", type);
    case "revision": return known(s.revision, "attention", type);
    case "finding": return known(s.finding, "info", type);
    case "complete": return known(s.complete, "success", type);
    case "blocked": return known(s.blocked, "danger", type);
    default: return unknown(copy, type);
  }
}

export function laneLabel(copy: TeamRedesignCopy, key?: string | null): string {
  const s = copy.lane;
  switch (key) {
    case "update": return s.update;
    case "report-back": return s.reportBack;
    case "user": return s.user;
    case "agent": return s.agent;
    case "runtime": return s.runtime;
    case "tool": return s.tool;
    default: return key ? key : s.update;
  }
}

/** Fills `{name}` placeholders; unknown placeholders are left untouched. */
export function fillTemplate(template: string, vars: Record<string, string | number | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}
