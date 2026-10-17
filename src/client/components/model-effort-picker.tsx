"use client";

/**
 * ModelEffortPicker — one capsule for "model · reasoning effort".
 *
 * Looks and behaves like AcpProviderDropdown (capsule button, portal panel,
 * outside-mousedown close). The panel lists models (grouped by the
 * config-options group name) above an effort segment control. Every option
 * comes from the `choices` prop; nothing is hard-coded here. Callers map the
 * values to their own storage (session POST, lane step fields, card PATCH).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { useTranslation } from "@/i18n";
import {
  findChoiceLabel,
  withStoredChoice,
  type ModelEffortChoice,
  type ModelEffortChoices,
} from "../model-effort/model-effort-choices";

export interface ModelEffortValue {
  /** "" = follow default. */
  model: string;
  /** "" = follow default. */
  reasoningEffort: string;
}

export interface ModelEffortPickerProps {
  choices: ModelEffortChoices | undefined;
  model: string | undefined;
  reasoningEffort: string | undefined;
  onChange: (next: ModelEffortValue) => void;
  /** Button cannot be clicked (e.g. a change is in flight). */
  disabled?: boolean;
  /** Read-only: the capsule shows the value but never opens; the reason is the tooltip. */
  readOnlyReason?: string;
  /** Capsule text when no model is chosen, e.g. "Default model" / "Use lane default". */
  emptyLabel: string;
  /** Capsule text for an empty effort; defaults to the shared "Default". */
  effortEmptyLabel?: string;
  variant?: "toolbar" | "form";
  ariaLabel?: string;
  testIdPrefix?: string;
  /** Offer the "Follow default" model item (off for a live session, which always has a model). */
  allowDefaultModel?: boolean;
  /** Make the "Default" effort segment selectable (off when the agent does not accept ""). */
  allowDefaultEffort?: boolean;
}

type PanelPosition = { left: number; top?: number; bottom?: number; maxHeight: number; minWidth: number };

interface ModelGroup {
  label: string | undefined;
  options: ModelEffortChoice[];
}

function groupModels(models: ModelEffortChoice[]): ModelGroup[] {
  const groups: ModelGroup[] = [];
  for (const model of models) {
    const last = groups[groups.length - 1];
    if (last && last.label === model.group) {
      last.options.push(model);
    } else {
      groups.push({ label: model.group, options: [model] });
    }
  }
  return groups;
}

const TOOLBAR_BUTTON_CLASS =
  "flex items-center gap-1.5 pl-2 pr-1.5 py-0.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-transparent transition-colors disabled:opacity-40 disabled:cursor-not-allowed aria-disabled:cursor-default aria-disabled:hover:bg-white dark:aria-disabled:hover:bg-transparent";
const FORM_BUTTON_CLASS =
  "flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition hover:bg-slate-50 focus:border-amber-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-[#0b1119] dark:text-slate-100 dark:hover:bg-[#111722]";

export function ModelEffortPicker({
  choices,
  model,
  reasoningEffort,
  onChange,
  disabled = false,
  readOnlyReason,
  emptyLabel,
  effortEmptyLabel,
  variant = "toolbar",
  ariaLabel,
  testIdPrefix = "model-effort-picker",
  allowDefaultModel = true,
  allowDefaultEffort = true,
}: ModelEffortPickerProps) {
  const { t } = useTranslation();
  const copy = t.kanbanModelSelection;
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<PanelPosition | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const readOnly = Boolean(readOnlyReason);
  const currentModel = model?.trim() ?? "";
  const currentEffort = reasoningEffort?.trim() ?? "";

  const modelChoices = useMemo(() => withStoredChoice(choices?.models ?? [], currentModel), [choices, currentModel]);
  const effortChoices = useMemo(
    () => withStoredChoice(choices?.reasoningEfforts ?? [], currentEffort),
    [choices, currentEffort],
  );
  const modelGroups = useMemo(() => groupModels(modelChoices), [modelChoices]);

  const modelText = findChoiceLabel(modelChoices, currentModel) ?? emptyLabel;
  const effortText = findChoiceLabel(effortChoices, currentEffort) ?? effortEmptyLabel ?? copy.defaultEffort;
  const showEffort = effortChoices.length > 0 || Boolean(effortEmptyLabel);
  const capsuleText = showEffort ? `${modelText} · ${effortText}` : modelText;
  const resolvedAriaLabel = ariaLabel ?? copy.pickerAriaLabel;

  const close = useCallback((restoreFocus: boolean) => {
    setIsOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  // Move focus into the list on open so arrow keys work right away.
  useEffect(() => {
    if (!isOpen) return;
    const selected = panelRef.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')
      ?? panelRef.current?.querySelector<HTMLElement>('[role="option"]');
    selected?.focus();
  }, [isOpen]);

  // A capsule that turns read-only (session process gone) must not keep a
  // stale panel open. `disabled` only greys the options out, so the panel
  // survives an in-flight change and the user can pick the effort next.
  const [wasReadOnly, setWasReadOnly] = useState(readOnly);
  if (readOnly !== wasReadOnly) {
    setWasReadOnly(readOnly);
    if (readOnly && isOpen) setIsOpen(false);
  }

  const open = () => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const preferredHeight = 420;
    const padding = 8;
    const spaceAbove = rect.top - padding;
    const spaceBelow = window.innerHeight - rect.bottom - padding;
    const base = { left: rect.left, minWidth: variant === "form" ? rect.width : 0 };
    setPosition(spaceBelow >= spaceAbove
      ? { ...base, top: rect.bottom + 4, maxHeight: Math.min(spaceBelow, preferredHeight) }
      : { ...base, bottom: window.innerHeight - rect.top + 4, maxHeight: Math.min(spaceAbove, preferredHeight) });
    setIsOpen(true);
  };

  const handleButtonClick = () => {
    if (readOnly || disabled) return;
    if (isOpen) {
      close(false);
      return;
    }
    open();
  };

  const selectModel = (value: string) => {
    if (value !== currentModel) onChange({ model: value, reasoningEffort: currentEffort });
  };

  const selectEffort = (value: string) => {
    if (value !== currentEffort) onChange({ model: currentModel, reasoningEffort: value });
  };

  const handlePanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const options = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
    if (options.length === 0) return;
    event.preventDefault();
    const index = options.indexOf(document.activeElement as HTMLElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = index === -1 ? 0 : (index + step + options.length) % options.length;
    options[nextIndex]?.focus();
  };

  const handleButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      close(true);
    }
  };

  const optionClass = (selected: boolean) => `flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-400 ${
    selected
      ? "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300"
      : "text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/50"
  }`;

  const renderOption = (value: string, label: string) => {
    const selected = value === currentModel;
    return (
      <button
        key={value || "__default__"}
        type="button"
        role="option"
        aria-selected={selected}
        tabIndex={-1}
        disabled={disabled}
        data-testid={`${testIdPrefix}-model-option`}
        data-value={value}
        onClick={() => selectModel(value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            selectModel(value);
          }
        }}
        className={optionClass(selected)}
      >
        <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
        {selected && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />}
      </button>
    );
  };

  return (
    <div className={variant === "form" ? "relative min-w-0" : "relative"}>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleButtonClick}
        onKeyDown={handleButtonKeyDown}
        disabled={disabled}
        aria-disabled={readOnly || undefined}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={resolvedAriaLabel}
        title={readOnlyReason ?? `${resolvedAriaLabel}: ${capsuleText}`}
        data-testid={testIdPrefix}
        data-readonly={readOnly || undefined}
        className={variant === "form" ? FORM_BUTTON_CLASS : TOOLBAR_BUTTON_CLASS}
      >
        <span
          className={variant === "form" ? "min-w-0 flex-1 truncate text-left" : "truncate max-w-56"}
          data-testid={`${testIdPrefix}-label`}
        >
          {capsuleText}
        </span>
        {!readOnly && (
          <ChevronDown className={`h-3 w-3 shrink-0 text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`} aria-hidden />
        )}
      </button>

      {isOpen && position && typeof document !== "undefined" && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label={resolvedAriaLabel}
          data-testid={`${testIdPrefix}-panel`}
          onKeyDown={handlePanelKeyDown}
          className="fixed w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl z-[9999] dark:border-slate-700 dark:bg-[#1e2130]"
          style={{
            left: position.left,
            top: position.top,
            bottom: position.bottom,
            minWidth: position.minWidth || undefined,
            maxHeight: `${position.maxHeight}px`,
          }}
        >
          <div className="flex max-h-[inherit] flex-col">
            <div className="border-b border-slate-100 px-3 py-2 dark:border-slate-800">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                {copy.model}
              </p>
            </div>
            <div role="listbox" aria-label={copy.model} className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
              {allowDefaultModel && renderOption("", copy.followDefault)}
              {modelGroups.map((group, index) => (
                <div key={`${group.label ?? "ungrouped"}-${index}`} role="group" aria-label={group.label}>
                  {group.label && (
                    <div className="px-3 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
                      {group.label}
                    </div>
                  )}
                  {group.options.map((choice) => renderOption(choice.value, choice.label))}
                </div>
              ))}
              {modelChoices.length === 0 && (
                <div className="px-3 py-2 text-[11px] text-slate-400 dark:text-slate-500">{copy.noModels}</div>
              )}
            </div>
            {(effortChoices.length > 0 || currentEffort) && (
              <div className="border-t border-slate-100 p-2 dark:border-slate-800">
                <p className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                  {copy.reasoningEffort}
                </p>
                <div
                  role="radiogroup"
                  aria-label={copy.reasoningEffort}
                  className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800/70"
                >
                  {[
                    // Not selectable: still shown while it is the current value.
                    ...(allowDefaultEffort || !currentEffort ? [{ value: "", label: copy.defaultEffort }] : []),
                    ...effortChoices,
                  ].map((choice) => {
                    const selected = choice.value === currentEffort;
                    const locked = !choice.value && !allowDefaultEffort;
                    return (
                      <button
                        key={choice.value || "__default__"}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        disabled={disabled || locked}
                        data-testid={`${testIdPrefix}-effort-option`}
                        data-value={choice.value}
                        onClick={() => selectEffort(choice.value)}
                        className={`min-w-0 flex-1 truncate rounded-md px-2 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-50 ${
                          selected
                            ? "bg-white text-blue-700 shadow-sm dark:bg-[#0b1119] dark:text-blue-300"
                            : "text-slate-600 hover:bg-white/70 dark:text-slate-300 dark:hover:bg-white/5"
                        }`}
                      >
                        {choice.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
