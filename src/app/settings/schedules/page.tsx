/**
 * Settings / Schedules - /settings/schedules
 * Workspace-aware schedule management page for triggers, recurring runs, and schedule tick diagnostics.
 */
"use client";

import { useState } from "react";
import { useTranslation } from "@/i18n";
import { SettingsRouteShell } from "@/client/components/settings-route-shell";
import { useWorkspaces } from "@/client/hooks/use-workspaces";
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import { SchedulePanel } from "@/client/components/schedule-panel";

const PILL_CLASS = "inline-flex items-center gap-1.5 rounded-md border border-default bg-subtle px-2 py-1 text-[11px] text-secondary";

export default function SchedulesSettingsPage() {
  const { t } = useTranslation();
  const copy = t.settingsRedesign.pages.schedules;
  const workspacesHook = useWorkspaces();
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const effectiveWorkspaceId = selectedWorkspaceId || workspacesHook.workspaces[0]?.id || "";

  return (
    <SettingsRouteShell
      activeSettingsItem="schedules"
      title={copy.title}
      description={copy.description}
      actions={(
        // Trigger and runtime pills restored from the pre-redesign header
        // (e4e5c162 L56-59); design-spec §12 keeps them visible.
        <div className="flex flex-wrap justify-end gap-2 min-[801px]:max-[1100px]:max-w-[22rem]" data-testid="schedules-header-pills">
          <span className={PILL_CLASS} data-testid="schedules-tick-pill">
            {t.settingsExtended.tickEndpoint}
            <code className="font-mono text-primary">/api/schedules/tick</code>
          </span>
          <span className={PILL_CLASS} data-testid="schedules-trigger-pill">
            {t.settingsExtended.triggerLabel}
            <span className="text-primary">{t.settingsExtended.triggerValue}</span>
          </span>
          <span className={PILL_CLASS} data-testid="schedules-runtime-pill">
            {t.settingsExtended.runtimeLabel}
            <span className="text-primary">{t.settingsExtended.runtimeValue}</span>
          </span>
        </div>
      )}
      workspaceSwitcher={(
        <WorkspaceSwitcher
          workspaces={workspacesHook.workspaces}
          activeWorkspaceId={effectiveWorkspaceId || null}
          activeWorkspaceTitle={workspacesHook.workspaces.find((workspace) => workspace.id === effectiveWorkspaceId)?.title}
          onSelect={setSelectedWorkspaceId}
          onCreate={async (title) => {
            const workspace = await workspacesHook.createWorkspace(title);
            if (workspace) {
              setSelectedWorkspaceId(workspace.id);
            }
          }}
          loading={workspacesHook.loading}
          compact
          desktop
        />
      )}
    >
      <SchedulePanel workspaceId={effectiveWorkspaceId || undefined} />
    </SettingsRouteShell>
  );
}
