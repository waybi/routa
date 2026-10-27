/**
 * The Blocked resolver as a Blocked-lane automation (card 4877583c). Shared
 * by the board settings (the "Automation" toggle on the Blocked lane writes
 * this structure) and the inbox (a card is handled by the resolver only when
 * its board's Blocked lane carries it).
 */

import type { KanbanColumnAutomation } from "@/core/models/kanban";
import type { KanbanSpecialistLanguage } from "./kanban-specialist-language";

export const BLOCKED_STAGE = "blocked";
export const BLOCKED_RESOLVER_SPECIALIST_ID = "kanban-blocked-resolver";
export const BLOCKED_RESOLVER_STEP_ID = "blocked-resolver";

/** Same names as resources/specialists/locales/<lang>/workflows/kanban/blocked-resolver.yaml. */
const BLOCKED_RESOLVER_NAMES: Record<KanbanSpecialistLanguage, string> = {
  en: "Blocked Resolver",
  "zh-CN": "阻塞处理员",
};

export function blockedResolverName(language: KanbanSpecialistLanguage | undefined): string {
  return BLOCKED_RESOLVER_NAMES[language ?? "en"] ?? BLOCKED_RESOLVER_NAMES.en;
}

/**
 * What the Blocked lane's "Automation" toggle writes when turned on: one
 * entry step running kanban-blocked-resolver, mirrored on the top level
 * like every other lane's primary step (the shape the four live boards use).
 */
export function getBlockedResolverAutomation(language?: KanbanSpecialistLanguage): KanbanColumnAutomation {
  const specialistName = blockedResolverName(language);
  const step = {
    id: BLOCKED_RESOLVER_STEP_ID,
    transport: "acp" as const,
    role: "CRAFTER",
    specialistId: BLOCKED_RESOLVER_SPECIALIST_ID,
    specialistName,
    ...(language ? { specialistLocale: language } : {}),
  };
  return {
    enabled: true,
    transitionType: "entry",
    steps: [step],
    role: step.role,
    specialistId: step.specialistId,
    specialistName,
    ...(language ? { specialistLocale: language } : {}),
  };
}

export interface ResolverAutomationLike {
  enabled?: boolean;
  specialistId?: string;
  steps?: ReadonlyArray<{ specialistId?: string }>;
}

/** Enabled, and one step (or the top-level mirror) runs kanban-blocked-resolver. */
export function hasBlockedResolver(automation: ResolverAutomationLike | null | undefined): boolean {
  if (automation?.enabled !== true) return false;
  return (automation.steps ?? []).some((step) => step?.specialistId === BLOCKED_RESOLVER_SPECIALIST_ID)
    || automation.specialistId === BLOCKED_RESOLVER_SPECIALIST_ID;
}
