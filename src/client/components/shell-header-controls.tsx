"use client";

import { DockerStatusIndicator } from "./docker-status-indicator";
import { LanguageSwitcher } from "./language-switcher";
import { McpStatusIndicator } from "./mcp-status-indicator";
import { NotificationBell } from "./notification-center";
import { ThemeSwitcher } from "./theme-switcher";


interface ShellHeaderControlsProps {
  className?: string;
  showPreferencesMenu?: boolean;
  compactStatus?: boolean;
}

export function ShellHeaderControls({
  className = "",
  showPreferencesMenu = false,
  compactStatus = false,
}: ShellHeaderControlsProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="hidden lg:flex">
        <DockerStatusIndicator compact={compactStatus} />
      </div>
      <div className="hidden lg:flex">
        <McpStatusIndicator compact={compactStatus} />
      </div>
      {/* Task lifecycle history, so a completion survives a tab switch. */}
      <NotificationBell />
      {showPreferencesMenu ? (
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <ThemeSwitcher compact />
        </div>
      ) : null}
    </div>
  );
}
