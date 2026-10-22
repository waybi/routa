/**
 * Settings / Workflows - /settings/workflows
 * Settings page for defining reusable workflows and reviewing workflow-focused execution configuration.
 */
"use client";

import { useTranslation } from "@/i18n";
import { SettingsRouteShell } from "@/client/components/settings-route-shell";
import { WorkflowPanel } from "@/client/components/workflow-panel";

export default function WorkflowSettingsPage() {
  const { t } = useTranslation();
  const copy = t.settingsRedesign.pages.workflows;
  return (
    <SettingsRouteShell activeSettingsItem="workflows" title={copy.title} description={copy.description}>
      <WorkflowPanel />
    </SettingsRouteShell>
  );
}
