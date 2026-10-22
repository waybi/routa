"use client";

import type { ReactNode } from "react";

import { DesktopAppShell } from "./desktop-app-shell";
import { SettingsCenterNav, type SettingsNavItem } from "./settings-center-nav";
import { SettingsPageHeader } from "./settings-page-header";

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
  /** Rendered as the 21px page title. */
  title: ReactNode;
  description?: ReactNode;
  /** Primary actions on the right of the page header. */
  actions?: ReactNode;
  /** Optional row under the title (for example tabs). */
  headerExtra?: ReactNode;
  children: ReactNode;
  workspaceId?: string | null;
  workspaceTitle?: string;
  workspaceSwitcher?: ReactNode;
  /** Class of the scrolling body under the header. */
  contentClassName?: string;
  activeSettingsItem?: SettingsNavItem;
}

export function SettingsRouteShell({
  title,
  description,
  actions,
  headerExtra,
  children,
  workspaceId,
  workspaceTitle,
  workspaceSwitcher,
  contentClassName,
  activeSettingsItem,
}: SettingsRouteShellProps) {
  return (
    <DesktopAppShell
      workspaceId={workspaceId}
      workspaceTitle={workspaceTitle}
      workspaceSwitcher={workspaceSwitcher}
    >
      <SettingsFrame activeItem={activeSettingsItem}>
        <div className="flex h-full min-h-0 flex-col">
          <SettingsPageHeader title={title} description={description} actions={actions}>
            {headerExtra}
          </SettingsPageHeader>
          <div className={contentClassName ?? "min-h-0 flex-1 overflow-auto px-6 py-5 max-[800px]:px-4"}>
            {children}
          </div>
        </div>
      </SettingsFrame>
    </DesktopAppShell>
  );
}
