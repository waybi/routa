"use client";

import React from "react";
import Link from "next/link";
import { Folder, Menu, Search } from "lucide-react";

import { useTranslation } from "@/i18n";
import { ShellHeaderControls } from "./shell-header-controls";

interface DesktopShellHeaderProps {
  workspaceId?: string | null;
  workspaceTitle?: string;
  titleBarRight?: React.ReactNode;
  workspaceSwitcher?: React.ReactNode;
  drawerOpen?: boolean;
  onToggleDrawer?: () => void;
  onOpenCommandPalette?: () => void;
}

/**
 * Top bar (design-spec §3, §7): narrow-screen menu button, workspace
 * switcher, page-specific actions, ⌘K entry, notification bell and
 * preferences. The empty middle stays draggable for the Tauri window.
 */
export function DesktopShellHeader({
  workspaceId,
  workspaceTitle,
  workspaceSwitcher,
  titleBarRight,
  drawerOpen = false,
  onToggleDrawer,
  onOpenCommandPalette,
}: DesktopShellHeaderProps) {
  const { t } = useTranslation();
  const normalizedWorkspaceId = workspaceId?.trim() || null;
  const workspaceHref = normalizedWorkspaceId ? `/workspace/${normalizedWorkspaceId}` : null;
  const workspaceLabel = workspaceTitle ?? normalizedWorkspaceId ?? t.workspace.workspaces;
  const pillClassName =
    "flex items-center gap-1.5 rounded-control border border-default bg-surface px-2.5 py-1 text-xs text-primary";

  return (
    <header
      aria-label={t.shell?.topbar.label}
      className="relative z-30 flex h-12 shrink-0 select-none items-center gap-2 border-b border-default bg-canvas px-4 min-[801px]:px-[22px] min-[1101px]:px-7"
      data-testid="desktop-shell-header"
    >
      {onToggleDrawer ? (
        <button
          type="button"
          onClick={onToggleDrawer}
          aria-label={drawerOpen ? t.shell?.nav.closeMenu : t.shell?.nav.openMenu}
          aria-expanded={drawerOpen}
          aria-controls="routa-shell-sidebar"
          data-testid="desktop-shell-menu-button"
          className="-ml-1 rounded-control p-1.5 text-secondary hover:bg-hover hover:text-primary min-[801px]:hidden"
        >
          <Menu className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}

      <div className="min-w-0 shrink" data-testid="desktop-shell-workspace-slot">
        {workspaceSwitcher ?? (
          workspaceHref ? (
            <Link href={workspaceHref} className={`${pillClassName} hover:bg-hover`}>
              <Folder className="h-3 w-3 text-secondary" aria-hidden="true" />
              <span className="max-w-40 truncate">{workspaceLabel}</span>
            </Link>
          ) : (
            <div className={`${pillClassName} text-secondary`}>
              <Folder className="h-3 w-3 text-secondary" aria-hidden="true" />
              <span className="max-w-40 truncate">{workspaceLabel}</span>
            </div>
          )
        )}
      </div>

      <div className="app-drag-region h-full min-w-4 flex-1" />

      {titleBarRight ? <div className="flex items-center gap-2">{titleBarRight}</div> : null}

      {onOpenCommandPalette ? (
        <button
          type="button"
          onClick={onOpenCommandPalette}
          data-testid="desktop-shell-command-button"
          aria-label={t.shell?.topbar.openCommandPalette}
          aria-keyshortcuts="Meta+K Control+K"
          className="flex items-center gap-2 rounded-control border border-default bg-surface px-2 py-1 text-xs text-secondary hover:bg-hover hover:text-primary"
        >
          <Search className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden min-[1101px]:inline">{t.shell?.topbar.openCommandPalette}</span>
          <kbd className="rounded border border-default bg-subtle px-1 font-mono text-[10px] text-secondary">
            {t.shell?.topbar.commandPaletteShortcut}
          </kbd>
        </button>
      ) : null}

      <ShellHeaderControls showPreferencesMenu compactStatus />
    </header>
  );
}
