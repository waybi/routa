/**
 * Model / reasoning-effort helpers for Kanban lane steps and card overrides.
 *
 * Parsing and the config-options cache live in src/client/model-effort/ and
 * are shared with the session composer; only the lane-step write rule stays
 * here.
 */

export {
  EMPTY_MODEL_EFFORT_CHOICES,
  MODEL_EFFORT_FALLBACK_PROVIDER_ID,
  parseModelEffortChoices,
  resolveModelOptionsProviderId,
  withStoredChoice,
  type ModelEffortChoice,
  type ModelEffortChoices,
} from "@/client/model-effort/model-effort-choices";

/** Apply a dropdown value to a step: "" removes the field instead of storing it. */
export function applyStepModelEffort<T extends { model?: string; reasoningEffort?: string }>(
  step: T,
  field: "model" | "reasoningEffort",
  value: string,
): T {
  const next = { ...step };
  const trimmed = value.trim();
  if (trimmed) {
    next[field] = trimmed;
  } else {
    delete next[field];
  }
  return next;
}
