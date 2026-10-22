"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";

import { SettingsRouteShell } from "@/client/components/settings-route-shell";
import { McpToolsExplorer } from "@/client/components/mcp-tools-explorer";
import { McpServersTab } from "@/client/components/settings-panel-mcp-tab";
import { useTranslation } from "@/i18n";

type McpTab = "servers" | "tools";

const TAB_HREF: Record<McpTab, string> = {
  servers: "/settings/mcp?tab=servers",
  tools: "/settings/mcp?tab=tools",
};

export function McpSettingsPageClient() {
  const { t } = useTranslation();
  const copy = t.settingsRedesign;
  const searchParams = useSearchParams();
  const activeTab = useMemo<McpTab>(() => (
    searchParams.get("tab") === "tools" ? "tools" : "servers"
  ), [searchParams]);

  const tabs = (
    <nav aria-label={copy.mcpPage.tabsLabel} className="flex gap-1 border-b border-default -mb-3">
      {(Object.keys(TAB_HREF) as McpTab[]).map((key) => {
        const active = key === activeTab;
        return (
          <Link
            key={key}
            href={TAB_HREF[key]}
            aria-current={active ? "page" : undefined}
            data-testid={`mcp-settings-tab-${key}`}
            className={`-mb-px border-b-2 px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent ${
              active
                ? "border-accent text-primary"
                : "border-transparent text-secondary hover:text-primary"
            }`}
          >
            {copy.mcpPage[key]}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <SettingsRouteShell
      activeSettingsItem={activeTab === "tools" ? "mcpTools" : "mcp"}
      title={activeTab === "tools" ? copy.mcpPage.toolsTitle : copy.pages.mcp.title}
      description={copy.pages.mcp.description}
      headerExtra={tabs}
    >
      {activeTab === "tools" ? (
        <McpToolsExplorer />
      ) : (
        <div className="rounded-lg border border-default bg-surface">
          <McpServersTab />
        </div>
      )}
    </SettingsRouteShell>
  );
}
