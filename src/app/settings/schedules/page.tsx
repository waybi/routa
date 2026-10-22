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
        <span className="inline-flex items-center gap-1.5 rounded-md border border-default bg-subtle px-2 py-1 text-[11px] text-secondary">
          {t.settingsExtended.tickEndpoint}
          <code className="font-mono text-primary">/api/schedules/tick</code>
        </span>
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
