"use client";

import React, { forwardRef } from "react";

import { HomeInput } from "@/client/components/home-input";

import { TEAM_LEAD_SPECIALIST_ID } from "./team-page-model";
import type { TeamRedesignCopy } from "./team-status-labels";

export interface TeamLaunchModeCopy {
  label: string;
  description: string;
  placeholder: string;
}

export const TeamLaunchPanel = forwardRef<HTMLElement, {
  id: string;
  copy: TeamRedesignCopy;
  modeCopy: TeamLaunchModeCopy;
  workspaceId: string;
  onSessionCreated: (
    sessionId: string,
    promptText: string,
    sessionContext?: { cwd?: string; branch?: string; repoName?: string },
  ) => void;
}>(function TeamLaunchPanel({ id, copy, modeCopy, workspaceId, onSessionCreated }, ref) {
  return (
    <section
      id={id}
      ref={ref}
      aria-label={copy.page.launchPanelTitle}
      data-testid="team-launch-panel"
      className="rounded-lg border border-default bg-surface p-4"
    >
      <div className="mb-3">
        <h2 className="m-0 text-[15px] font-semibold text-primary">{copy.page.launchPanelTitle}</h2>
        <p className="m-0 mt-1 text-xs text-secondary">{copy.page.launchPanelDescription}</p>
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
        onSessionCreated={onSessionCreated}
      />
    </section>
  );
});
