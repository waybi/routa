import type { McpServerProfile } from "./mcp-server-profiles";

export const KANBAN_PLANNING_UPDATE_TASK_FIELDS = new Set([
  "taskId",
  "expectedVersion",
  "agentId",
  "sessionId",
  "title",
  "objective",
  "scope",
  "acceptanceCriteria",
  "verificationCommands",
  "testCases",
  "contextSearchSpec",
  "jitContextAnalysis",
]);

export const HIGH_RISK_UPDATE_TASK_FIELDS = new Set([
  "status",
  "columnId",
  "column_id",
  "dependencies",
  "completionSummary",
  "verificationVerdict",
  "verificationReport",
  "assignedTo",
  "assignedProvider",
  "assignedRole",
  "assignedSpecialistId",
  "releaseLabel",
  "approval",
  "ownerVerdict",
]);

/**
 * Review verdict fields a kanban-planning session may write when it is the
 * Review lane GATE session for the task (see `canSessionWriteVerificationVerdict` in `kanban/review-verdict-authority`).
 */
export const REVIEW_GATE_VERDICT_FIELDS = new Set([
  "verificationVerdict",
  "verificationReport",
]);

const REVIEW_GATE_VERDICT_NOTE = "Only the Review lane GATE session of this card may set this; other sessions get an error.";

/** JSON-schema properties the kanban-planning update_task definition exposes for the review verdict. */
export const KANBAN_PLANNING_VERDICT_PROPERTIES = {
  verificationVerdict: { type: "string", enum: ["APPROVED", "NOT_APPROVED", "BLOCKED"], description: REVIEW_GATE_VERDICT_NOTE },
  verificationReport: { type: "string", description: REVIEW_GATE_VERDICT_NOTE },
};

/** Field description suffix for protected update_task fields under a profile. */
export function protectedUpdateTaskFieldNote(field: string, profile?: McpServerProfile): string {
  if (profile !== "kanban-planning") return "";
  return REVIEW_GATE_VERDICT_FIELDS.has(field)
    ? `. ${REVIEW_GATE_VERDICT_NOTE}`
    : ". Not writable in the kanban-planning profile; passing it returns an error.";
}

function isProvided(value: unknown): boolean {
  return value !== undefined;
}

export function blockedUpdateTaskFieldsForProfile(
  params: Record<string, unknown>,
  profile?: McpServerProfile,
  options?: { allowVerificationFields?: boolean },
): string[] {
  if (profile !== "kanban-planning") {
    return [];
  }

  return Object.keys(params).filter((field) => {
    if (!isProvided(params[field])) {
      return false;
    }
    if (KANBAN_PLANNING_UPDATE_TASK_FIELDS.has(field)) {
      return false;
    }
    if (options?.allowVerificationFields && REVIEW_GATE_VERDICT_FIELDS.has(field)) {
      return false;
    }
    return HIGH_RISK_UPDATE_TASK_FIELDS.has(field);
  });
}

export function requestsVerificationFields(params: Record<string, unknown>): boolean {
  return [...REVIEW_GATE_VERDICT_FIELDS].some((field) => isProvided(params[field]));
}

/**
 * Resolve the protected fields an update_task call must be rejected for.
 * Under kanban-planning, verdict fields are allowed only when `resolveVerdictAuthority`
 * confirms the caller is the Review lane GATE session; it is only consulted when
 * the call actually carries verdict fields.
 */
export async function resolveBlockedUpdateTaskFields(
  params: Record<string, unknown>,
  profile: McpServerProfile | undefined,
  resolveVerdictAuthority: () => Promise<boolean>,
): Promise<string[]> {
  if (profile !== "kanban-planning") {
    return [];
  }
  let allowVerificationFields = false;
  if (requestsVerificationFields(params)) {
    try {
      allowVerificationFields = await resolveVerdictAuthority();
    } catch {
      allowVerificationFields = false;
    }
  }
  return blockedUpdateTaskFieldsForProfile(params, profile, { allowVerificationFields });
}

export function updateTaskBoundaryError(
  fields: string[],
  profile: McpServerProfile,
): string {
  const fieldList = fields.map((field) => `\`${field}\``).join(", ");
  const verdictHint = fields.some((field) => REVIEW_GATE_VERDICT_FIELDS.has(field))
    ? " `verificationVerdict`/`verificationReport` can only be written by the Review lane GATE session of this card."
    : "";
  return `${profile} cannot write protected task workflow fields via update_task: ${fieldList}. Use move_card for lane/status changes, provide artifacts for evidence, and leave owner/review metadata to the appropriate gate.${verdictHint}`;
}
