"use client";

/**
 * Model · reasoning-effort capsule in the kanban dispatch bar. Options come
 * from GET /api/providers/{board provider}/config-options (shared cache);
 * "" = follow the provider default. A provider without options keeps the
 * capsule visible but disabled, so dispatching is never blocked.
 */

import { ModelEffortPicker, type ModelEffortValue } from "@/client/components/model-effort-picker";
import { useModelEffortChoices } from "./kanban-model-effort-fields";
import type { KanbanTaskAgentCopy } from "./i18n/kanban-task-agent";

export const EMPTY_DISPATCH_MODEL_EFFORT: ModelEffortValue = { model: "", reasoningEffort: "" };

export interface KanbanDispatchModelEffortProps {
  providerId: string;
  value: ModelEffortValue;
  onChange: (next: ModelEffortValue) => void;
  disabled?: boolean;
  copy: KanbanTaskAgentCopy;
}

export function KanbanDispatchModelEffort({ providerId, value, onChange, disabled, copy }: KanbanDispatchModelEffortProps) {
  const choicesByProvider = useModelEffortChoices(providerId ? [providerId] : []);
  const choices = providerId ? choicesByProvider[providerId] : undefined;
  const hasOptions = Boolean(choices && (choices.models.length > 0 || choices.reasoningEfforts.length > 0));
  return (
    <div className="shrink-0 border-r border-default pr-1" title={copy.modelEffortHint}>
      <ModelEffortPicker
        choices={choices}
        model={value.model}
        reasoningEffort={value.reasoningEffort}
        onChange={onChange}
        disabled={disabled}
        disabledReason={choices && !hasOptions ? copy.modelEffortUnsupported : undefined}
        emptyLabel={copy.modelEffortDefault}
        effortEmptyLabel={copy.modelEffortDefault}
        defaultModelHint={copy.modelEffortHint}
        ariaLabel={copy.modelEffortAriaLabel}
        testIdPrefix="kanban-dispatch-model-effort"
      />
    </div>
  );
}
