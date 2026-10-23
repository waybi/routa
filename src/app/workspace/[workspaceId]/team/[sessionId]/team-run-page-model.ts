import type { ChatMessage } from "@/client/components/chat-panel/types";
import { getToolEventLabel } from "@/client/components/chat-panel/tool-call-name";
import type { NoteData } from "@/client/hooks/use-notes";
import type { SessionInfo } from "../../types";

export interface SpecialistSummary {
  id: string;
  name: string;
  description?: string;
  role?: string;
}

export interface AgentSummary {
  id: string;
  name: string;
  role: string;
  status: string;
  parentId?: string;
  createdAt: string;
  updatedAt?: string;
  metadata?: Record<string, string>;
}

export type NormalizedTaskStatus = "not-started" | "in-progress" | "waiting-review" | "done" | "blocked";
export type TeamMemberStatus = "idle" | "working" | "blocked" | "reviewing" | "done";
export type CoordinationEventType = "plan" | "assign" | "revision" | "finding" | "complete" | "blocked";
export type RoleTone = "lead" | "qa" | "research" | "frontend" | "backend" | "review" | "ux" | "ops" | "general" | "neutral";

export interface TeamTaskNode {
  id: string;
  title: string;
  status: NormalizedTaskStatus;
  details?: string;
  /** Member session the task was handed to, when recorded. */
  sessionId?: string;
  children: TeamTaskNode[];
}

export interface TeamActivityItem {
  id: string;
  type: CoordinationEventType;
  title: string;
  actor: string;
  actorRoleId?: string;
  target?: string;
  targetRoleId?: string;
  timestamp: string;
  summary?: string;
  sessionId?: string;
  memberSession?: {
    sessionId: string;
    actor: string;
    roleId?: string;
    badge: string;
    sessionName?: string;
    preview?: string;
    lastUpdatedLabel: string;
    eventCount: number;
    provider?: string;
  };
}

export interface SessionStreamSummary {
  session: SessionInfo;
  actor: string;
  badge: string;
  preview?: string;
  eventCount: number;
  lastUpdatedLabel: string;
  lastUpdatedAt: number;
}

export interface TeamMemberItem {
  id: string;
  actor: string;
  roleId?: string;
  roleLabel: string;
  status: TeamMemberStatus;
  lastUpdatedLabel?: string;
  sessionId?: string;
  preview?: string;
  avatarLabel: string;
}

export interface SessionLaneSnippet {
  id: string;
  label: string;
  text: string;
  kind: "user" | "message" | "tool" | "report" | "error";
  tone: "default" | "tool" | "complete" | "blocked";
}

export interface SessionLaneItem {
  id: string;
  sessionId: string;
  actor: string;
  roleId?: string;
  roleLabel?: string;
  badge: string;
  sessionName: string;
  status: TeamMemberStatus;
  lastUpdatedLabel: string;
  provider?: string;
  eventCount: number;
  snippets: SessionLaneSnippet[];
  messages: ChatMessage[];
  completionSummary?: string;
  pendingQuestion?: PendingSessionQuestion | null;
  isLead?: boolean;
}

export interface SessionTimelineItem {
  id: string;
  sessionId: string;
  title: string;
  actor: string;
  actorRoleId?: string;
  timestamp: string;
  summary?: string;
  tone?: "default" | "tool" | "complete" | "blocked";
  memberLane?: SessionLaneItem;
  pendingQuestion?: PendingSessionQuestion | null;
}

export interface DeliverableItem {
  id: string;
  label: string;
  title: string;
  owner: string;
  status: "draft" | "review" | "approved";
  summary?: string;
  sessionId?: string;
  updatedAt: number;
}

export interface SessionHistoryEntry {
  sessionId: string;
  update?: {
    sessionUpdate?: string;
    content?:
      | { type?: string; text?: string }
      | Array<{ type?: string; text?: string; content?: { type?: string; text?: string } }>;
    status?: string;
    title?: string;
    taskStatus?: string;
    completionSummary?: string;
    agentId?: string;
    name?: string;
    error?: string;
    toolCallId?: string;
    rawInput?: Record<string, unknown>;
    rawOutput?: { output?: string };
  };
}

type RosterRoleLookup = Pick<Map<string, string>, "get">;

export interface AskUserQuestionItem {
  question: string;
  header: string;
  options?: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
}

export interface PendingSessionQuestion {
  sessionId: string;
  toolCallId: string;
  questions: AskUserQuestionItem[];
  answers?: Record<string, string>;
  status?: string;
}

export const TEAM_LEAD_SPECIALIST_ID = "team-agent-lead";

export function mapAgentStatus(status?: string): TeamMemberStatus {
  switch ((status ?? "").toUpperCase()) {
    case "ACTIVE":
      return "working";
    case "COMPLETED":
      return "done";
    case "ERROR":
    case "CANCELLED":
      return "blocked";
    default:
      return "idle";
  }
}

export function avatarInitials(label: string): string {
  return label
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function normalizeTaskStatus(status?: string): NormalizedTaskStatus {
  const normalized = status?.toUpperCase();
  if (normalized === "COMPLETED" || normalized === "DONE") return "done";
  if (normalized === "IN_PROGRESS" || normalized === "RUNNING" || normalized === "CONFIRMED") return "in-progress";
  if (normalized === "REVIEW_REQUIRED" || normalized === "WAITING_REVIEW" || normalized === "NEEDS_REVIEW") return "waiting-review";
  if (normalized === "FAILED" || normalized === "BLOCKED" || normalized === "NEEDS_FIX") return "blocked";
  return "not-started";
}

/** Five design-spec tones (ui/badge.tsx); colors come from tokens, never palettes. */
export type TeamTone = "neutral" | "info" | "attention" | "danger" | "success";

export function memberStatusTone(status: TeamMemberStatus): TeamTone {
  switch (status) {
    case "working":
      return "info";
    case "reviewing":
      return "attention";
    case "blocked":
      return "danger";
    case "done":
      return "success";
    default:
      return "neutral";
  }
}

export function deliverableStatusTone(status: DeliverableItem["status"]): TeamTone {
  if (status === "approved") return "success";
  if (status === "review") return "attention";
  return "neutral";
}

export function roleTone(roleId?: string): RoleTone {
  if (!roleId) return "neutral";
  if (roleId === TEAM_LEAD_SPECIALIST_ID) return "lead";
  if (roleId.includes("qa")) return "qa";
  if (roleId.includes("research")) return "research";
  if (roleId.includes("frontend")) return "frontend";
  if (roleId.includes("backend")) return "backend";
  if (roleId.includes("review")) return "review";
  if (roleId.includes("ux")) return "ux";
  if (roleId.includes("operations")) return "ops";
  if (roleId.includes("general")) return "general";
  return "neutral";
}

/**
 * Role chips and avatars share the token palette: the lead is accented,
 * verifying roles use attention, builders use information, the rest neutral.
 */
const ROLE_TOKEN_CLASS: Record<RoleTone, string> = {
  lead: "border-accent bg-accent-subtle text-accent",
  qa: "border-attention bg-attention-subtle text-attention",
  review: "border-attention bg-attention-subtle text-attention",
  research: "border-default bg-success-subtle text-success",
  frontend: "border-default bg-accent-subtle text-information",
  backend: "border-default bg-accent-subtle text-information",
  ux: "border-default bg-accent-subtle text-information",
  ops: "border-default bg-subtle text-primary",
  general: "border-default bg-subtle text-primary",
  neutral: "border-default bg-subtle text-secondary",
};

export function roleChipClass(roleId?: string): string {
  return ROLE_TOKEN_CLASS[roleTone(roleId)];
}

export function roleAvatarClass(roleId?: string): string {
  return ROLE_TOKEN_CLASS[roleTone(roleId)].replace(/border-\S+\s/, "");
}

export function sessionBadge(session: SessionInfo): string {
  if (!session.parentSessionId) return "lead";
  return session.specialistId ?? session.role ?? session.provider ?? "session";
}

export function resolveRosterSpecialistId(
  session: SessionInfo,
  agentsById?: Map<string, AgentSummary>,
  delegatedRosterIdsBySessionId?: RosterRoleLookup,
): string | undefined {
  const metadataRosterId = session.routaAgentId
    ? agentsById?.get(session.routaAgentId)?.metadata?.rosterRoleId
    : undefined;
  if (metadataRosterId?.startsWith("team-")) return metadataRosterId;

  const direct = session.specialistId;
  if (direct?.startsWith("team-")) return direct;

  const delegatedRosterId = delegatedRosterIdsBySessionId?.get(session.sessionId);
  if (delegatedRosterId?.startsWith("team-")) return delegatedRosterId;

  const signature = `${session.specialistId ?? ""} ${session.role ?? ""} ${session.name ?? ""}`.toLowerCase();
  if (signature.includes("agent lead") || signature.includes("team-agent-lead")) return TEAM_LEAD_SPECIALIST_ID;
  if (signature.includes("qa") || signature.includes("gate")) return "team-qa";
  if (signature.includes("research")) return "team-researcher";
  if (signature.includes("frontend")) return "team-frontend-dev";
  if (signature.includes("backend")) return "team-backend-dev";
  if (signature.includes("review")) return "team-code-reviewer";
  if (signature.includes("ux") || signature.includes("design")) return "team-ux-designer";
  if (signature.includes("operations")) return "team-operations";
  if (signature.includes("general")) return "team-general-engineer";
  return undefined;
}

export function getActorLabel(
  session: SessionInfo,
  specialistsById: Map<string, SpecialistSummary>,
  agentsById?: Map<string, AgentSummary>,
  delegatedRosterIdsBySessionId?: RosterRoleLookup,
): string {
  const displayLabel = session.routaAgentId
    ? agentsById?.get(session.routaAgentId)?.metadata?.displayLabel
    : undefined;
  if (displayLabel) return displayLabel;

  const rosterId = resolveRosterSpecialistId(session, agentsById, delegatedRosterIdsBySessionId);
  return specialistsById.get(rosterId ?? session.specialistId ?? "")?.name ?? session.name ?? session.specialistId ?? session.role ?? "Agent";
}

export function summarizeText(text?: string, max = 220): string | undefined {
  const normalized = text?.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
}

export function normalizeObjectiveText(text?: string): string | undefined {
  const normalized = text
    ?.replace(/\s*\n+\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || undefined;
}

export function extractHistoryText(update?: SessionHistoryEntry["update"]): string | undefined {
  if (!update?.content) return undefined;
  if (!Array.isArray(update.content)) {
    return summarizeText(update.content.text);
  }

  const joined = update.content
    .map((item) => item.text ?? item.content?.text ?? "")
    .join(" ")
    .trim();
  return summarizeText(joined || undefined);
}

export function extractFullHistoryText(update?: SessionHistoryEntry["update"]): string | undefined {
  if (!update?.content) return undefined;
  if (!Array.isArray(update.content)) {
    return update.content.text?.trim() || undefined;
  }

  const joined = update.content
    .map((item) => item.text ?? item.content?.text ?? "")
    .join(" ")
    .trim();
  return joined || undefined;
}

export function isLowSignalLeadMessage(text?: string): boolean {
  const normalized = text?.replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized) return true;
  const mentionsResearcherDispatch = normalized.includes("已派发 researcher")
    || normalized.includes("dispatch a researcher")
    || normalized.includes("dispatch researcher")
    || normalized.includes("researcher 调查 issue");
  const mentionsReportBack = normalized.includes("正在等待回报")
    || normalized.includes("report back")
    || normalized.includes("report my findings to the parent")
    || normalized.includes("report findings to the parent")
    || normalized.includes("report back to the parent");
  return (
    normalized.includes("已派发 researcher 任务。正在等待回报")
    || normalized.includes("reported completion back to lead (auto-submitted by orchestrator)")
    || normalized.includes("正在等待回报")
    || (mentionsResearcherDispatch && mentionsReportBack)
  );
}

export function extractLeadHeadingKey(text?: string): string | null {
  if (!text) return null;
  const firstLine = text
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return null;
  const heading = firstLine.match(/^#+\s+(.*)$/)?.[1] ?? firstLine;
  const normalized = heading.replace(/\s+/g, " ").trim().toLowerCase();
  return normalized || null;
}

export function resolveDelegationTarget(update?: SessionHistoryEntry["update"]): string | undefined {
  const rawInput = update?.rawInput;
  if (!rawInput) return undefined;

  const specialist = typeof rawInput.specialist === "string" ? rawInput.specialist : undefined;
  if (specialist?.startsWith("team-")) {
    return specialist
      .replace(/^team-/, "")
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  const additionalInstructions =
    typeof rawInput.additionalInstructions === "string" ? rawInput.additionalInstructions : undefined;
  const emphasizedRole = additionalInstructions?.match(/\*\*([^*]+)\*\*/)?.[1]?.trim();
  if (emphasizedRole) return emphasizedRole;

  if (!specialist) return undefined;
  switch (specialist.toLowerCase()) {
    case "researcher":
      return "Research Analyst";
    case "backend-dev":
    case "backend":
      return "Backend Developer";
    case "frontend-dev":
    case "frontend":
      return "Frontend Dev";
    case "qa":
    case "qa-specialist":
      return "QA Specialist";
    case "code-reviewer":
    case "reviewer":
      return "Code Reviewer";
    case "ux-designer":
      return "UX Designer";
    case "operations":
    case "ops":
      return "Operations Engineer";
    case "general-engineer":
      return "General Engineer";
    case "crafter":
      return "Implementor";
    case "gate":
      return "Verifier";
    case "developer":
      return "Developer";
    default:
      return specialist;
  }
}

export function resolveDelegationRosterSpecialistId(update?: SessionHistoryEntry["update"]): string | undefined {
  const rawInput = update?.rawInput;
  if (!rawInput) return undefined;

  const directSpecialist = typeof rawInput.specialist === "string" ? rawInput.specialist : undefined;
  if (directSpecialist?.startsWith("team-")) return directSpecialist;

  const hintText = [
    typeof rawInput.additionalInstructions === "string" ? rawInput.additionalInstructions : "",
    typeof rawInput.description === "string" ? rawInput.description : "",
  ]
    .join(" ")
    .toLowerCase();

  switch (directSpecialist?.toLowerCase()) {
    case "researcher":
      return "team-researcher";
    case "backend-dev":
    case "backend":
      return "team-backend-dev";
    case "frontend-dev":
    case "frontend":
      return "team-frontend-dev";
    case "qa":
    case "qa-specialist":
    case "gate":
      return "team-qa";
    case "code-reviewer":
    case "reviewer":
      return "team-code-reviewer";
    case "ux-designer":
      return "team-ux-designer";
    case "operations":
    case "ops":
      return "team-operations";
    case "general-engineer":
      return "team-general-engineer";
    case "crafter":
    case "developer":
      if (hintText.includes("research")) return "team-researcher";
      if (hintText.includes("frontend")) return "team-frontend-dev";
      if (hintText.includes("backend")) return "team-backend-dev";
      if (hintText.includes("ux") || hintText.includes("design")) return "team-ux-designer";
      if (hintText.includes("review")) return "team-code-reviewer";
      return "team-general-engineer";
    default:
      return undefined;
  }
}

export function extractDelegationSessionId(update?: SessionHistoryEntry["update"]): string | undefined {
  const output = update?.rawOutput?.output;
  if (!output) return undefined;

  try {
    const parsed = JSON.parse(output);
    return typeof parsed?.sessionId === "string" ? parsed.sessionId : undefined;
  } catch {
    const match = output.match(/"sessionId"\s*:\s*"([^"]+)"/);
    return match?.[1];
  }
}

export function inferDeliverableLabel(note: NoteData, ownerId?: string): string {
  const text = `${note.title} ${note.content}`.toLowerCase();
  if (note.metadata.type === "spec") return "spec draft";
  if (text.includes("ui") || text.includes("design")) return "ui proposal";
  if (ownerId?.includes("qa") || ownerId?.includes("review")) return "test report";
  if (ownerId?.includes("research")) return "findings";
  if (ownerId?.includes("front") || ownerId?.includes("back") || ownerId?.includes("general")) return "patch";
  return note.metadata.type === "task" ? "work package" : "team note";
}

export function toMemberSessionSummary(
  stream: SessionStreamSummary | undefined,
  session: SessionInfo,
  actor: string,
  roleId?: string,
) {
  if (!stream) return undefined;
  return {
    sessionId: session.sessionId,
    actor,
    roleId,
    badge: stream.badge,
    sessionName: session.name ?? session.sessionId,
    preview: stream.preview,
    lastUpdatedLabel: stream.lastUpdatedLabel,
    eventCount: stream.eventCount,
    provider: session.provider ?? undefined,
  };
}

export function extractAskUserQuestionPayload(update?: SessionHistoryEntry["update"]): PendingSessionQuestion | null {
  if (!update?.toolCallId) return null;
  const rawInput = update.rawInput;
  const questions = Array.isArray(rawInput?.questions)
    ? rawInput.questions.filter((item): item is AskUserQuestionItem => Boolean(item && typeof item === "object" && typeof item.question === "string"))
    : [];
  const answers = rawInput?.answers && typeof rawInput.answers === "object"
    ? Object.fromEntries(
      Object.entries(rawInput.answers).filter(
        ([, value]) => typeof value === "string" && value.trim().length > 0,
      ) as Array<[string, string]>,
    )
    : undefined;
  const looksLikeAskUserQuestion =
    update.title === "AskUserQuestion"
    || update.name === "AskUserQuestion"
    || questions.length > 0;

  if (!looksLikeAskUserQuestion) return null;

  return {
    sessionId: "",
    toolCallId: update.toolCallId,
    questions,
    answers: answers && Object.keys(answers).length > 0 ? answers : undefined,
    status: update.status,
  };
}

export function inferSessionDeliverableLabel(specialistId?: string): string {
  if (!specialistId) return "deliverable";
  if (specialistId.includes("research")) return "findings";
  if (specialistId.includes("qa") || specialistId.includes("review")) return "test report";
  if (specialistId.includes("ux")) return "ui proposal";
  if (specialistId.includes("front") || specialistId.includes("back") || specialistId.includes("general")) return "patch";
  return "deliverable";
}

export type CompletionTitleKey = "blocker" | "revision" | "review" | "findings" | "ui-proposal" | "phase";

/** Completion event type plus a title key; the caller renders the title through i18n. */
export function inferCompletionEvent(
  session: SessionInfo,
  update: NonNullable<SessionHistoryEntry["update"]>,
): { type: CoordinationEventType; titleKey: CompletionTitleKey; summary?: string } {
  const specialistId = session.specialistId ?? "";
  const taskStatus = normalizeTaskStatus(update.taskStatus);
  const summary = summarizeText(update.completionSummary ?? extractHistoryText(update));

  if (taskStatus === "blocked") return { type: "blocked", titleKey: "blocker", summary };
  if (specialistId.includes("qa") || specialistId.includes("review")) {
    if (taskStatus === "waiting-review") return { type: "revision", titleKey: "revision", summary };
    return { type: "complete", titleKey: "review", summary };
  }
  if (specialistId.includes("research")) return { type: "finding", titleKey: "findings", summary };
  if (specialistId.includes("ux")) return { type: "complete", titleKey: "ui-proposal", summary };
  return { type: "complete", titleKey: "phase", summary };
}

export function laneSnippetTone(update?: SessionHistoryEntry["update"]): SessionLaneSnippet["tone"] {
  if (update?.sessionUpdate === "task_completion") {
    return normalizeTaskStatus(update.taskStatus) === "blocked" ? "blocked" : "complete";
  }
  if (update?.sessionUpdate === "tool_call_update") return "tool";
  if (update?.sessionUpdate === "acp_status" && update.status === "error") return "blocked";
  return "default";
}

export function laneSnippetKind(update?: SessionHistoryEntry["update"]): SessionLaneSnippet["kind"] {
  if (update?.sessionUpdate === "user_message") return "user";
  if (update?.sessionUpdate === "agent_message") return "message";
  if (update?.sessionUpdate === "tool_call_update") return "tool";
  if (update?.sessionUpdate === "task_completion") return "report";
  if (update?.sessionUpdate === "acp_status" && update.status === "error") return "error";
  return "message";
}

/**
 * Lane snippet label as a key (update / report-back / user / agent / runtime /
 * tool) or a raw tool name; the UI translates keys via team-status-labels.
 */
export function laneSnippetLabel(update?: SessionHistoryEntry["update"]): string {
  if (!update?.sessionUpdate) return "update";
  if (update.sessionUpdate === "tool_call_update") {
    return getToolEventLabel(update as Record<string, unknown>) || "tool";
  }
  if (update.sessionUpdate === "task_completion") return "report-back";
  if (update.sessionUpdate === "user_message") return "user";
  if (update.sessionUpdate === "agent_message") return "agent";
  if (update.sessionUpdate === "acp_status" && update.status === "error") return "runtime";
  return update.sessionUpdate.replaceAll("_", " ");
}

export function buildLaneSnippets(history: SessionHistoryEntry[], maxSnippets = 5): SessionLaneSnippet[] {
  const snippets = history
    .map((entry, index) => {
      const update = entry.update;
      const updateType = update?.sessionUpdate;
      if (!updateType || updateType === "agent_message_chunk" || updateType === "agent_thought_chunk") return null;
      if (updateType === "acp_status" && update.status !== "error") return null;

      const text = updateType === "task_completion"
        ? summarizeText(update.completionSummary ?? extractHistoryText(update) ?? "Member finished and handed the result back to lead.", 180)
        : summarizeText(
          extractHistoryText(update)
            ?? update.rawOutput?.output
            ?? update.error
            ?? (typeof update.rawInput?.additionalInstructions === "string" ? update.rawInput.additionalInstructions : undefined)
            ?? (typeof update.rawInput?.title === "string" ? update.rawInput.title : undefined),
          180,
        );

      if (!text) return null;
      if (isLowSignalLeadMessage(text)) return null;
      return {
        id: `${entry.sessionId}-${index}`,
        label: laneSnippetLabel(update),
        text,
        kind: laneSnippetKind(update),
        tone: laneSnippetTone(update),
      } satisfies SessionLaneSnippet;
    })
    .filter((snippet): snippet is SessionLaneSnippet => Boolean(snippet))
    .filter((snippet, index, all) => {
      const previous = all[index - 1];
      return !previous || previous.label !== snippet.label || previous.text !== snippet.text;
    });

  return snippets.slice(-maxSnippets);
}

export function extractGoalFromPrompt(text?: string): string | undefined {
  const normalized = text?.trim();
  if (!normalized) return undefined;

  const markdownGoal = normalized.match(/(?:^|\n)##\s*Goal\s+([\s\S]*?)(?=\n##\s|\n@@@|$)/i)?.[1]?.trim();
  if (markdownGoal) {
    return summarizeText(markdownGoal, 320);
  }

  if (/routa coordinator|you plan, delegate, and verify/i.test(normalized)) {
    return undefined;
  }

  return summarizeText(normalized, 320);
}

export function findObjectiveText(session: SessionInfo | null, rootHistory: SessionHistoryEntry[], notes: NoteData[]): string {
  const sessionName = normalizeObjectiveText(session?.name?.replace(/^Team\s*-\s*/i, "").trim());
  if (sessionName && !/^team automation verifier$/i.test(sessionName)) {
    return sessionName;
  }

  const latestUserRequest = rootHistory.find((entry) => entry.update?.sessionUpdate === "user_message");
  const explicitRequest = extractGoalFromPrompt(extractHistoryText(latestUserRequest?.update));
  if (explicitRequest) return explicitRequest;

  const specNote = notes
    .filter((note) => note.metadata.type === "spec")
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
  if (specNote?.content.trim()) {
    return normalizeObjectiveText(extractGoalFromPrompt(specNote.content))
      ?? normalizeObjectiveText(summarizeText(specNote.content, 320))
      ?? normalizeObjectiveText(specNote.content)
      ?? specNote.content;
  }

  return normalizeObjectiveText(session?.name) ?? "Team objective not captured yet.";
}
