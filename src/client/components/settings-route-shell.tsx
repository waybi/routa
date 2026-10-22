"use client";

import type { ReactNode } from "react";

import { DesktopAppShell } from "./desktop-app-shell";
import { SettingsCenterNav, type SettingsNavItem } from "./settings-center-nav";

/**
 * Settings frame: the left sub-navigation plus the page body. Every
 * settings page (and /mcp-tools via its redirect) renders inside it, so the
 * sub-navigation is always present; pages that use DesktopAppShell directly
 * (overview, harness, fluency) wrap their body in it as well.
 */
export function SettingsFrame({ activeItem, children }: { activeItem?: SettingsNavItem; children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 bg-canvas text-primary max-[800px]:flex-col" data-testid="settings-frame">
      <SettingsCenterNav activeItem={activeItem} />
      <div className="h-full min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}


interface SettingsRouteShellProps {
  title: string;
  description: string;
  children: ReactNode;
  workspaceId?: string | null;
  workspaceTitle?: string;
  badgeLabel?: string;
  icon?: ReactNode;
  summary?: Array<{ label: string; value: string }>;
  workspaceSwitcher?: ReactNode;
  contentClassName?: string;
  activeSettingsItem?: SettingsNavItem;
}

export function SettingsRouteShell({
  title,
  description,
  children,
  workspaceId,
  workspaceTitle,
  badgeLabel,
  icon,
  summary = [],
  workspaceSwitcher,
  contentClassName,
  activeSettingsItem,
}: SettingsRouteShellProps) {
  void badgeLabel;
  void summary;
  void description;
  void title;
  void icon;

  return (
    <DesktopAppShell
      workspaceId={workspaceId}
      workspaceTitle={workspaceTitle}
      workspaceSwitcher={workspaceSwitcher}
    >
      <SettingsFrame activeItem={activeSettingsItem}>
        <div className={contentClassName ?? "flex min-h-full w-full flex-col px-8 py-8"}>
          {children}
        </div>
      </SettingsFrame>
    </DesktopAppShell>
  );
}
