"use client";

/**
 * Desktop App Shell — shared layout for every page (web and Tauri).
 *
 * Redesign (design-spec §3, §7): sidebar on the left (collapsible to an icon
 * rail above 800px, remembered in localStorage), a top bar
 * with the workspace switcher, ⌘K entry and notification bell, and the page
 * content on the right. Below 800px the sidebar becomes a drawer opened from
 * the top-left button. The command palette is mounted once here so ⌘K / Ctrl+K
 * works on every page that uses the shell.
 */

import React, { useCallback, useState } from "react";

import { DesktopShellHeader } from "./desktop-shell-header";
import { DesktopSidebar } from "./desktop-sidebar";
import { useSidebarCollapsed } from "./shell/use-sidebar-collapsed";
import { CommandPalette } from "./ui/command-palette";

export interface DesktopAppShellProps {
  children: React.ReactNode;
  workspaceId?: string | null;
  /** Current workspace title for display */
  workspaceTitle?: string;
  /** Optional right side content for the title bar */
  titleBarRight?: React.ReactNode;
  /** Optional workspace switcher component */
  workspaceSwitcher?: React.ReactNode;
}

export function DesktopAppShell({
  children,
  workspaceId,
  workspaceTitle,
  titleBarRight,
  workspaceSwitcher,
}: DesktopAppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const { collapsed, toggleCollapsed } = useSidebarCollapsed();

  return (
    <div
      className="desktop-theme flex h-screen overflow-hidden bg-canvas text-primary"
      data-testid="desktop-shell-root"
    >
      <DesktopSidebar
        workspaceId={workspaceId}
        drawerOpen={drawerOpen}
        onDrawerClose={closeDrawer}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
      />

      <div className="flex min-w-0 flex-1 flex-col" data-testid="desktop-shell-body">
        <DesktopShellHeader
          workspaceId={workspaceId}
          workspaceTitle={workspaceTitle}
          workspaceSwitcher={workspaceSwitcher}
          titleBarRight={titleBarRight}
          drawerOpen={drawerOpen}
          onToggleDrawer={() => setDrawerOpen((open) => !open)}
          onOpenCommandPalette={openPalette}
        />

        <main
          className="min-h-0 min-w-0 flex-1 overflow-hidden bg-canvas"
          data-testid="desktop-shell-main"
        >
          {children}
        </main>
      </div>

      <CommandPalette
        workspaceId={workspaceId}
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
      />
    </div>
  );
}
