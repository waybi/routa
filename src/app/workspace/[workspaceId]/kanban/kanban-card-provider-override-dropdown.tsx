"use client";

import { useMemo } from "react";
import type { AcpProviderInfo } from "@/client/acp-client";
import { AcpProviderDropdown } from "@/client/components/acp-provider-dropdown";
import { useTranslation } from "@/i18n";
import type { TaskInfo } from "../types";
import { ModelEffortPicker } from "@/client/components/model-effort-picker";
import { useModelEffortChoices } from "./kanban-model-effort-fields";
import { resolveModelOptionsProviderId } from "./kanban-model-effort-options";

interface KanbanCardProviderOverrideDropdownProps {
  task: TaskInfo;
  hasCardOverride: boolean;
  availableProviders: AcpProviderInfo[];
  overrideProviderValue: string;
  compact?: boolean;
  onPatchTask: (taskId: string, payload: Record<string, unknown>) => Promise<TaskInfo>;
  onProviderChange?: (providerId: string | null) => void;
}

function getProviderName(providerId: string, availableProviders: AcpProviderInfo[]): string {
  return availableProviders.find((provider) => provider.id === providerId)?.name ?? providerId;
}

export function KanbanCardProviderOverrideDropdown({
  task,
  hasCardOverride,
  availableProviders,
  overrideProviderValue,
  compact = false,
  onPatchTask,
  onProviderChange,
}: KanbanCardProviderOverrideDropdownProps) {
  const { t } = useTranslation();
  const overrideProviderOptions = useMemo(() => {
    if (!overrideProviderValue || availableProviders.some((provider) => provider.id === overrideProviderValue)) {
      return availableProviders;
    }

    return [
      ...availableProviders,
      {
        id: overrideProviderValue,
        name: getProviderName(overrideProviderValue, availableProviders),
        description: overrideProviderValue,
        command: overrideProviderValue,
        status: "unavailable" as const,
      },
    ];
  }, [availableProviders, overrideProviderValue]);

  const handleOverrideProviderChange = async (providerId: string) => {
    const newProvider = providerId || null;
    if (newProvider) {
      await onPatchTask(task.id, {
        assignedProvider: newProvider,
        assignedRole: hasCardOverride ? task.assignedRole ?? "DEVELOPER" : "DEVELOPER",
      });
      onProviderChange?.(newProvider);
      return;
    }

    await onPatchTask(task.id, {
      assignedProvider: undefined,
      assignedRole: undefined,
      assignedSpecialistId: undefined,
      assignedSpecialistName: undefined,
    });
    onProviderChange?.(null);
  };

  return (
    <AcpProviderDropdown
      providers={overrideProviderOptions}
      selectedProvider={overrideProviderValue}
      onProviderChange={handleOverrideProviderChange}
      allowAuto
      autoLabel={t.kanban.useLaneDefault}
      showStatusDot={Boolean(overrideProviderValue)}
      ariaLabel={t.kanbanDetail.cardSessionOverride}
      dataTestId="kanban-detail-provider-override"
      buttonClassName={`flex w-full items-center justify-between gap-2 rounded-md border border-slate-200/80 bg-white text-sm text-slate-700 transition-colors hover:bg-slate-50 focus:border-amber-400 focus:outline-none dark:border-slate-700 dark:bg-[#0b1119] dark:text-slate-300 dark:hover:bg-[#111722] ${compact ? "px-2.5 py-2" : "px-3 py-2"}`}
      labelClassName="min-w-0 flex-1 truncate text-left"
    />
  );
}

/**
 * Card-level model / reasoning effort override. Saved through PATCH
 * /api/tasks/{id} (only the changed field); "Use lane default" sends null to
 * clear. The value is read when the next lane session starts and never
 * touches a running one.
 */
export function KanbanCardModelEffortOverride({
  task,
  providerIds,
  onPatchTask,
}: {
  task: TaskInfo;
  /**
   * Candidates for the provider whose config-options list the choices, in
   * order: the effective provider (card override, else lane step), then the
   * board auto provider. Falls back to dsh.
   */
  providerIds: Array<string | null | undefined>;
  /** Accepted for call-site compatibility; the form picker has one size. */
  compact?: boolean;
  onPatchTask: (taskId: string, payload: Record<string, unknown>) => Promise<TaskInfo>;
}) {
  const { t } = useTranslation();
  const optionsProviderId = resolveModelOptionsProviderId(...providerIds);
  const choices = useModelEffortChoices([optionsProviderId]);
  const label = t.kanbanModelSelection.cardModelEffortOverride;
  const currentModel = task.assignedModel?.trim() ?? "";
  const currentEffort = task.assignedReasoningEffort?.trim() ?? "";

  return (
    <label className="block space-y-1" data-testid="kanban-detail-model-effort-override">
      <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{label}</span>
      <ModelEffortPicker
        variant="form"
        choices={choices[optionsProviderId]}
        model={currentModel}
        reasoningEffort={currentEffort}
        emptyLabel={t.kanban.useLaneDefault}
        effortEmptyLabel={t.kanban.useLaneDefault}
        ariaLabel={label}
        testIdPrefix="kanban-detail-override-model-effort"
        onChange={(next) => {
          if (next.model !== currentModel) void onPatchTask(task.id, { assignedModel: next.model || null });
          if (next.reasoningEffort !== currentEffort) {
            void onPatchTask(task.id, { assignedReasoningEffort: next.reasoningEffort || null });
          }
        }}
      />
    </label>
  );
}
