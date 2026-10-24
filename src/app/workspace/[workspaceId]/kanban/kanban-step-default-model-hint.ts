"use client";

/**
 * Hover text for a lane step left on "follow default": the model the step
 * really runs (specialist model > global tier setting > code tier table) and
 * where its reasoning effort comes from (global tier setting > acp default).
 */
import { useCallback } from "react";

import { useTranslation } from "@/i18n";
import {
  buildStepDefaultHint,
  toSpecialistLocale,
  useKanbanModelTiers,
} from "@/client/kanban-model-tiers/use-kanban-model-tiers";

export function useStepDefaultModelHint(): (specialistId: string | undefined, providerId: string | undefined) => string | undefined {
  const { t, locale } = useTranslation();
  const { data } = useKanbanModelTiers(toSpecialistLocale(locale));
  const copy = t.kanbanModelTiers;

  return useCallback(
    (specialistId, providerId) => buildStepDefaultHint(copy, data, specialistId, providerId),
    [copy, data],
  );
}
