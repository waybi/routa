"use client";

import React, { forwardRef } from "react";
import { Cpu } from "lucide-react";

import { HomeInput } from "@/client/components/home-input";
import type { InsertTextRequest } from "@/client/components/tiptap-input";

import { TEAM_LEAD_SPECIALIST_ID } from "./team-page-model";
import type { TeamRedesignCopy } from "./team-status-labels";

export interface TeamLaunchModeCopy {
  label: string;
  description: string;
  placeholder: string;
}

/** Team runs start on DeepSeek Harness unless the user picked a provider (same default as the board). */
export const TEAM_DEFAULT_PROVIDER_ID = "dsh";

/** "model · reasoning effort" capsule options for the launch box (card 15). */
export function teamModelEffortPickerOptions(copy: TeamRedesignCopy) {
  const text = copy.modelEffort;
  return {
    ariaLabel: text.ariaLabel,
    emptyLabel: text.followDefault,
    unsupportedReason: text.unsupported,
    searchable: { placeholder: text.searchPlaceholder, noMatch: text.noMatch },
    effortLabels: {
      "": text.effortDefault,
      low: text.effortLow,
      medium: text.effortMedium,
      high: text.effortHigh,
      xhigh: text.effortXhigh,
      max: text.effortMax,
    },
    footerNote: text.note,
    leadingIcon: <Cpu className="h-3 w-3 shrink-0 text-secondary" aria-hidden />,
    returnFocusOnDismiss: true,
  };
}

/** Template chips under the launch box, in display order. */
export function launchTemplates(copy: TeamRedesignCopy): string[] {
  return [copy.launch.template1, copy.launch.template2, copy.launch.template3, copy.launch.template4];
}

const SHELL_CLASS = [
  "rounded-xl border border-default bg-surface px-3 pb-2 pt-3",
  "transition-[border-color,box-shadow] duration-200 motion-reduce:transition-none",
  "focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/15",
  // The frame above replaces HomeInput's own glow, border and 2xl width cap, so there is one full-width composer outline.
  "[&>.max-w-2xl]:max-w-none",
  "[&_#home-input-container>div:first-child]:hidden",
  "[&_#home-input-container>div:last-child]:border-0 [&_#home-input-container>div:last-child]:bg-transparent [&_#home-input-container>div:last-child]:shadow-none",
  // Editor grows while focused or once it has text (empty paragraphs carry .is-editor-empty).
  "[&_.ProseMirror]:min-h-[66px] [&_.ProseMirror]:transition-[min-height] motion-reduce:[&_.ProseMirror]:transition-none",
  "focus-within:[&_.ProseMirror]:min-h-[104px]",
  "has-[.ProseMirror_p:not(.is-editor-empty)]:[&_.ProseMirror]:min-h-[104px]",
].join(" ");

/**
 * Always-visible team launch box (team page v2). The HomeInput configuration
 * is the legacy one, prop for prop; only the frame and the template chips are new.
 */
export const TeamLaunchPanel = forwardRef<HTMLElement, {
  id: string;
  copy: TeamRedesignCopy;
  modeCopy: TeamLaunchModeCopy;
  workspaceId: string;
  insertTextRequest?: InsertTextRequest | null;
  onTemplate: (text: string) => void;
  onSessionCreated: (
    sessionId: string,
    promptText: string,
    sessionContext?: { cwd?: string; branch?: string; repoName?: string },
  ) => void;
}>(function TeamLaunchPanel({ id, copy, modeCopy, workspaceId, insertTextRequest, onTemplate, onSessionCreated }, ref) {
  return (
    <section id={id} ref={ref} aria-label={copy.page.launchPanelTitle} data-testid="team-launch-panel" className="flex min-w-0 flex-col gap-2.5">
      <div className={SHELL_CLASS} data-testid="team-launch-shell">
        <div className="mb-1 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 px-1">
          <h2 className="m-0 text-[13px] font-semibold text-primary">{copy.page.launchPanelTitle}</h2>
          <p className="m-0 min-w-0 text-xs text-secondary">{copy.page.launchPanelDescription}</p>
        </div>
        <HomeInput
          workspaceId={workspaceId}
          variant="default"
          footerMetaMode="repo-only"
          initialLaunchModeId="team"
          launchModes={[{
            id: "team",
            label: modeCopy.label,
            description: modeCopy.description,
            placeholder: modeCopy.placeholder,
            defaultAgentRole: "ROUTA",
            allowRoleSwitch: false,
            allowCustomSpecialist: false,
            lockedSpecialistId: TEAM_LEAD_SPECIALIST_ID,
            requireRepoSelection: true,
            dispatchMode: "pending-prompt",
            buildSessionUrl: (nextWorkspaceId, sessionId) =>
              `/workspace/${nextWorkspaceId ?? workspaceId}/team/${sessionId}`,
          }]}
          insertTextRequest={insertTextRequest}
          onSessionCreated={onSessionCreated}
          alwaysShowModelEffortPicker
          modelEffortTestIdPrefix="team-model-effort-picker"
          modelEffortPickerOptions={teamModelEffortPickerOptions(copy)}
          preferredDefaultProvider={TEAM_DEFAULT_PROVIDER_ID}
        />
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2" data-testid="team-launch-templates">
        <span className="text-[11px] text-secondary">{copy.launch.templatesLabel}</span>
        {launchTemplates(copy).map((text, index) => (
          <button
            key={text}
            type="button"
            onClick={() => onTemplate(text)}
            data-testid={`team-launch-template-${index + 1}`}
            className="min-h-7 rounded-full border border-default bg-transparent px-3 py-0.5 text-xs text-secondary transition-colors hover:border-accent hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none"
          >
            {text}
          </button>
        ))}
      </div>
    </section>
  );
});
