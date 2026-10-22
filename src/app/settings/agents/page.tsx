/**
 * Settings / Agents - /settings/agents
 * Settings page for installing, discovering, and managing ACP-compatible agent runtimes.
 */
"use client";

import { AgentInstallPanel } from "@/client/components/agent-install-panel";
import { SettingsRouteShell } from "@/client/components/settings-route-shell";
import { buttonClassName } from "@/client/components/ui/button";
import { useTranslation } from "@/i18n";

export default function AgentSettingsPage() {
  const { t } = useTranslation();
  const copy = t.settingsRedesign.pages.agents;

  return (
    <SettingsRouteShell
      activeSettingsItem="agents"
      title={copy.title}
      description={copy.description}
      actions={(
        <a
          href="https://agentclientprotocol.com"
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClassName("secondary", "sm")}
        >
          {t.agents.learnAboutACP}
        </a>
      )}
      contentClassName="min-h-0 flex-1 overflow-hidden px-6 py-5 max-[800px]:px-4"
    >
      <div className="h-full overflow-hidden rounded-lg border border-default bg-surface">
        <AgentInstallPanel embedded />
      </div>
    </SettingsRouteShell>
  );
}
