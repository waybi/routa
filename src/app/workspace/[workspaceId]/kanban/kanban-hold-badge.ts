/**
 * Text of the card's hold badge (cards beb29624, a00fb67b). A card with the
 * whole-card "hold" shows only the original badge; a card with only
 * "hold:<role>" labels shows the held roles. At most one badge per card.
 */
import { isTaskOnHold, listHeldSpecialists } from "@/core/kanban/task-hold";
import type { TranslationDictionary } from "@/i18n";

export type HoldBadge =
  | { kind: "card"; text: string; tooltip: string }
  | { kind: "role"; text: string; tooltip: string; roles: string[] };

type HoldBadgeText = Pick<TranslationDictionary, "kanbanHold" | "kanbanRoleHold">;

export function formatHoldBadge(task: { labels?: readonly unknown[] | null }, t: HoldBadgeText): HoldBadge | null {
  if (isTaskOnHold(task)) return { kind: "card", text: t.kanbanHold.badge, tooltip: t.kanbanHold.tooltip };
  const roles = listHeldSpecialists(task);
  if (roles.length === 0) return null;
  const joined = roles.join(t.kanbanRoleHold.roleSeparator);
  return {
    kind: "role",
    roles,
    text: t.kanbanRoleHold.roleBadge.replace("{roles}", joined),
    tooltip: t.kanbanRoleHold.roleTooltip.replace("{roles}", joined),
  };
}
