/**
 * Coordination events for the team-session "事件" tab, derived from the
 * real run history (objective, plan, dispatch, new teammate, member session
 * opened, completion, runtime error). Pure function: titles come from the
 * teamRedesign dictionary, never from English templates.
 */
import { getToolEventLabel } from "@/client/components/chat-panel/tool-call-name";
import type { NoteData } from "@/client/hooks/use-notes";
import type { SessionInfo } from "../../types";
import { fillTemplate, type TeamRedesignCopy } from "../team-status-labels";
import {
  extractGoalFromPrompt,
  extractHistoryText,
  inferCompletionEvent,
  resolveDelegationRosterSpecialistId,
  resolveDelegationTarget,
  summarizeText,
  type CompletionTitleKey,
  type CoordinationEventType,
  type SessionHistoryEntry,
} from "./team-run-page-model";

export interface CoordinationEvent {
  id: string;
  type: CoordinationEventType;
  title: string;
  actor: string;
  target?: string;
  /** ISO time used for the relative-time label. */
  occurredAt: string;
  sortKey: number;
  summary?: string;
  /** Member session this event belongs to; absent for lead-only events. */
  sessionId?: string;
}

export interface CoordinationInput {
  session: SessionInfo | null;
  sessionId: string;
  rootHistory: SessionHistoryEntry[];
  notes: NoteData[];
  descendantSessions: SessionInfo[];
  historiesBySessionId: Record<string, SessionHistoryEntry[]>;
  leadName: string;
  /** Display name of a member session. */
  actorOf: (child: SessionInfo) => string;
  /** Latest member session for a roster role, if any. */
  linkedSessionIdForRoster: (rosterId: string) => string | undefined;
}

const COMPLETION_TITLE: Record<CompletionTitleKey, keyof TeamRedesignCopy["events"]> = {
  blocker: "completionBlocker",
  revision: "completionRevision",
  review: "completionReview",
  findings: "completionFindings",
  "ui-proposal": "completionUiProposal",
  phase: "completionPhase",
};

export const MAX_COORDINATION_EVENTS = 24;

export function buildCoordinationEvents(input: CoordinationInput, copy: TeamRedesignCopy): CoordinationEvent[] {
  const { session, sessionId, rootHistory, notes, descendantSessions, historiesBySessionId, leadName } = input;
  const events = copy.events;
  const items: CoordinationEvent[] = [];
  if (!session) return items;
  const sessionTime = new Date(session.createdAt).getTime();

  const requestEntry = rootHistory.find((entry) => entry.update?.sessionUpdate === "user_message");
  if (requestEntry) {
    items.push({
      id: `${session.sessionId}-objective`,
      type: "plan",
      title: events.objectiveSet,
      actor: events.userActor,
      target: leadName,
      occurredAt: session.createdAt,
      summary: extractGoalFromPrompt(extractHistoryText(requestEntry.update)) ?? extractHistoryText(requestEntry.update),
      sortKey: sessionTime,
    });
  }

  const latestSpec = notes
    .filter((note) => note.metadata.type === "spec")
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
  if (latestSpec) {
    items.push({
      id: `spec-${latestSpec.id}`,
      type: "plan",
      title: fillTemplate(events.leadCreatedPlan, { actor: leadName }),
      actor: leadName,
      occurredAt: latestSpec.updatedAt,
      summary: extractGoalFromPrompt(latestSpec.content) ?? summarizeText(latestSpec.content),
      sortKey: new Date(latestSpec.updatedAt).getTime(),
    });
  }

  rootHistory.forEach((entry, index) => {
    const update = entry.update;
    if (!update?.sessionUpdate || update.sessionUpdate !== "tool_call_update") return;
    const toolLabel = getToolEventLabel(update as Record<string, unknown>);
    const sortKey = sessionTime + index / 1000;

    if (toolLabel.includes("delegate_task")) {
      const target = resolveDelegationTarget(update) ?? events.teamMemberFallback;
      const rosterId = resolveDelegationRosterSpecialistId(update);
      const failed = update.status === "failed";
      items.push({
        id: `${sessionId}-delegate-${index}`,
        type: failed ? "blocked" : "assign",
        title: fillTemplate(failed ? events.dispatchFailed : events.taskAssigned, { target }),
        actor: leadName,
        target,
        occurredAt: session.createdAt,
        summary: summarizeText(
          typeof update.rawInput?.additionalInstructions === "string"
            ? update.rawInput.additionalInstructions
            : update.rawOutput?.output,
        ),
        sessionId: rosterId ? input.linkedSessionIdForRoster(rosterId) : undefined,
        sortKey,
      });
    }

    if (toolLabel.includes("create_agent")) {
      const target = typeof update.rawInput?.name === "string" ? update.rawInput.name : events.teammateFallback;
      const role = typeof update.rawInput?.role === "string" ? update.rawInput.role : undefined;
      items.push({
        id: `${sessionId}-create-agent-${index}`,
        type: "assign",
        title: fillTemplate(events.createdTeammate, { target }),
        actor: leadName,
        target,
        occurredAt: session.createdAt,
        summary: role ? fillTemplate(events.joinedAs, { target, role }) : undefined,
        sortKey,
      });
    }
  });

  for (const child of descendantSessions) {
    const actor = input.actorOf(child);
    const childTime = new Date(child.createdAt).getTime();
    items.push({
      id: `${child.sessionId}-opened`,
      type: "assign",
      title: fillTemplate(events.openedSession, { target: actor }),
      actor: leadName,
      target: actor,
      occurredAt: child.createdAt,
      summary: summarizeText(child.name ?? child.specialistId ?? child.role ?? child.provider),
      sessionId: child.sessionId,
      sortKey: childTime,
    });

    (historiesBySessionId[child.sessionId] ?? []).forEach((entry, index) => {
      const update = entry.update;
      if (!update?.sessionUpdate) return;
      const sortKey = childTime + index / 1000;
      if (update.sessionUpdate === "task_completion") {
        const completion = inferCompletionEvent(child, update);
        items.push({
          id: `${child.sessionId}-completion-${index}`,
          type: completion.type,
          title: fillTemplate(events[COMPLETION_TITLE[completion.titleKey]], { actor }),
          actor,
          occurredAt: child.createdAt,
          summary: completion.summary,
          sessionId: child.sessionId,
          sortKey,
        });
        return;
      }
      if (update.sessionUpdate === "acp_status" && update.status === "error") {
        items.push({
          id: `${child.sessionId}-error-${index}`,
          type: "blocked",
          title: fillTemplate(events.runtimeError, { actor }),
          actor,
          occurredAt: child.createdAt,
          summary: summarizeText(update.error),
          sessionId: child.sessionId,
          sortKey,
        });
      }
    });
  }

  return items.sort((a, b) => b.sortKey - a.sortKey).slice(0, MAX_COORDINATION_EVENTS);
}
