"use client";

/**
 * Hover text for a lane step left on "follow default": the model the step
 * really runs (specialist model > global tier setting > code tier table).
 */
import { useCallback } from "react";

import { useTranslation } from "@/i18n";
import {
  resolveStepDefaultModel,
  toSpecialistLocale,
  useKanbanModelTiers,
} from "@/client/kanban-model-tiers/use-kanban-model-tiers";

export function useStepDefaultModelHint(): (specialistId: string | undefined, providerId: string | undefined) => string | undefined {
  const { t, locale } = useTranslation();
  const { data } = useKanbanModelTiers(toSpecialistLocale(locale));
  const copy = t.kanbanModelTiers;

  return useCallback((specialistId, providerId) => {
    const resolved = resolveStepDefaultModel(data, specialistId, providerId);
    if (!resolved) return undefined;
    if (resolved.kind === "none") return copy.followDefaultHintNoTier;
    const source = resolved.kind === "specialist"
      ? copy.hintSourceSpecialist
      : (resolved.kind === "global" ? copy.hintSourceGlobal : copy.hintSourceCode)
        .replace("{tier}", copy.tiers[resolved.tier]);
    return copy.followDefaultHint.replace("{model}", resolved.model).replace("{source}", source);
  }, [copy, data]);
}
