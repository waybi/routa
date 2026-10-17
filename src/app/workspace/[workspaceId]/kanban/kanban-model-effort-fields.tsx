"use client";

import { useMemo, type ReactNode } from "react";
import { Select } from "@/client/components/select";
import { useTranslation } from "@/i18n";
import { withStoredChoice, type ModelEffortChoices } from "./kanban-model-effort-options";

export {
  resetModelEffortChoicesCache,
  useModelEffortChoices,
} from "@/client/model-effort/use-model-effort-choices";

export function ModelEffortSelects({
  choices,
  model,
  reasoningEffort,
  onModelChange,
  onReasoningEffortChange,
  selectClassName,
  testIdPrefix,
  modelLabel: modelLabelProp,
  reasoningEffortLabel: reasoningEffortLabelProp,
  renderField = (_label, control) => control,
}: {
  choices: ModelEffortChoices | undefined;
  model: string | undefined;
  reasoningEffort: string | undefined;
  onModelChange: (value: string) => void;
  onReasoningEffortChange: (value: string) => void;
  selectClassName: string;
  testIdPrefix: string;
  /** Defaults to the shared "Model" label. */
  modelLabel?: string;
  /** Defaults to the shared "Reasoning effort" label. */
  reasoningEffortLabel?: string;
  renderField?: (label: string, control: ReactNode) => ReactNode;
}) {
  const { t } = useTranslation();
  const copy = t.kanbanModelSelection;
  const modelChoices = useMemo(
    () => withStoredChoice(choices?.models ?? [], model),
    [choices, model],
  );
  const effortChoices = useMemo(
    () => withStoredChoice(choices?.reasoningEfforts ?? [], reasoningEffort),
    [choices, reasoningEffort],
  );
  const modelLabel = modelLabelProp ?? copy.model;
  const effortLabel = reasoningEffortLabelProp ?? copy.reasoningEffort;

  return (
    <>
      {renderField(modelLabel, (
        <Select
          aria-label={modelLabel}
          data-testid={`${testIdPrefix}-model`}
          value={model ?? ""}
          onChange={(event) => onModelChange(event.target.value)}
          className={selectClassName}
        >
          <option value="">{copy.followDefault}</option>
          {modelChoices.map((choice) => (
            <option key={choice.value} value={choice.value}>{choice.label}</option>
          ))}
        </Select>
      ))}
      {renderField(effortLabel, (
        <Select
          aria-label={effortLabel}
          data-testid={`${testIdPrefix}-reasoning-effort`}
          value={reasoningEffort ?? ""}
          onChange={(event) => onReasoningEffortChange(event.target.value)}
          className={selectClassName}
        >
          <option value="">{copy.followDefault}</option>
          {effortChoices.map((choice) => (
            <option key={choice.value} value={choice.value}>{choice.label}</option>
          ))}
        </Select>
      ))}
    </>
  );
}
