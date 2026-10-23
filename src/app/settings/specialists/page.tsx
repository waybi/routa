/**
 * Settings / Specialists - /settings/specialists
 * Settings page for configuring specialist personas, bindings, and model-aware specialist behavior.
 */
"use client";

import { useState } from "react";

import { KanbanModelTiersCard } from "@/client/components/kanban-model-tiers-card";
import { SettingsRouteShell } from "@/client/components/settings-route-shell";
import { SpecialistsTab } from "@/client/components/settings-panel-specialists-tab";
import { loadModelDefinitions } from "@/client/components/settings-panel-shared";
import { useTranslation } from "@/i18n";

export default function SpecialistsSettingsPage() {
  const [modelDefs] = useState(() => loadModelDefinitions());
  const { t } = useTranslation();
  const copy = t.settingsRedesign.pages.specialists;

  return (
    <SettingsRouteShell
      activeSettingsItem="specialists"
      title={copy.title}
      description={copy.description}
      contentClassName="flex min-h-0 flex-1 flex-col"
    >
      <KanbanModelTiersCard />
      <SpecialistsTab modelDefs={modelDefs} />
    </SettingsRouteShell>
  );
}
