"use client";

/**
 * Model / reasoning-effort selects plus a short "current value" label for the
 * active session. Which select renders is decided only by the configOptions
 * the agent advertised (no provider-name checks).
 */

import {
  MODEL_CONFIG_ID,
  REASONING_EFFORT_CONFIG_ID,
  findOption,
  flattenOptionValues,
  parseModelValue,
  summarizeConfigOptions,
  type AcpConfigOption,
  type AcpConfigSelectGroup,
  type AcpConfigSelectValue,
} from "@/core/acp/config-options";
import { useTranslation } from "@/i18n";

export interface SessionConfigSelectsProps {
  configOptions: AcpConfigOption[] | null;
  /** Session has no live agent process (404): read-only. */
  unavailable: boolean;
  /** A change is in flight: disable both selects. */
  pending: boolean;
  /** Model stored for the session (used read-only when unavailable). */
  fallbackModel?: string;
  onChange: (configId: string, value: string) => void;
}

function isGroup(entry: AcpConfigSelectValue | AcpConfigSelectGroup): entry is AcpConfigSelectGroup {
  return Array.isArray((entry as AcpConfigSelectGroup).options);
}

function valueLabel(entry: AcpConfigSelectValue, isModel: boolean): string {
  if (entry.name) return entry.name;
  return isModel ? parseModelValue(entry.value)?.model ?? entry.value : entry.value;
}

const selectClass =
  "max-w-[220px] truncate rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-700 "
  + "disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-[#161922] dark:text-slate-300";

function ConfigSelect({
  option,
  isModel,
  label,
  disabled,
  onChange,
}: {
  option: AcpConfigOption;
  isModel: boolean;
  label: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  // "" is a real value (provider default effort); never coerce it with `||`.
  const current = typeof option.currentValue === "string" ? option.currentValue : "";
  const known = flattenOptionValues(option).some((entry) => entry.value === current);
  return (
    <select
      aria-label={label}
      title={label}
      data-testid={`session-config-select-${option.id}`}
      className={selectClass}
      value={current}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {!known && <option value={current}>{isModel ? parseModelValue(current)?.model ?? current : current}</option>}
      {(option.options ?? []).map((entry) =>
        isGroup(entry) ? (
          <optgroup key={`group-${entry.group}`} label={entry.name ?? entry.group}>
            {entry.options.map((child) => (
              <option key={child.value} value={child.value}>{valueLabel(child, isModel)}</option>
            ))}
          </optgroup>
        ) : (
          <option key={entry.value} value={entry.value}>{valueLabel(entry, isModel)}</option>
        ),
      )}
    </select>
  );
}

export function SessionConfigSelects({
  configOptions,
  unavailable,
  pending,
  fallbackModel,
  onChange,
}: SessionConfigSelectsProps) {
  const { t } = useTranslation();
  const labels = t.chat.sessionConfig;
  const modelOption = findOption(configOptions ?? undefined, MODEL_CONFIG_ID);
  const effortOption = findOption(configOptions ?? undefined, REASONING_EFFORT_CONFIG_ID);
  const hasSelects = Boolean(modelOption || effortOption);

  // Nothing to show: the agent has no such options and we are not in read-only mode.
  if (!hasSelects && !(unavailable && fallbackModel)) return null;

  const summary = summarizeConfigOptions(configOptions ?? undefined);
  const modelText = summary.model ?? (unavailable ? fallbackModel : undefined) ?? labels.unknownModel;
  const effortText = summary.reasoningEffort === undefined
    ? labels.unknownEffort
    : summary.reasoningEffort === "" ? labels.defaultEffort : summary.reasoningEffort;
  const disabled = unavailable || pending;

  return (
    <div className="flex flex-wrap items-center gap-2 px-1 text-[11px] text-slate-500 dark:text-slate-400" data-testid="session-config-bar">
      <span className="font-mono" data-testid="session-config-label">
        {labels.model}: {modelText} · {labels.reasoningEffort}: {effortText}
      </span>
      {modelOption && (
        <ConfigSelect
          option={modelOption}
          isModel
          label={labels.model}
          disabled={disabled}
          onChange={(value) => onChange(MODEL_CONFIG_ID, value)}
        />
      )}
      {effortOption && (
        <ConfigSelect
          option={effortOption}
          isModel={false}
          label={labels.reasoningEffort}
          disabled={disabled}
          onChange={(value) => onChange(REASONING_EFFORT_CONFIG_ID, value)}
        />
      )}
      {unavailable && (
        <span className="text-amber-600 dark:text-amber-400" data-testid="session-config-resume-hint">
          {labels.resumeToSwitch}
        </span>
      )}
    </div>
  );
}
