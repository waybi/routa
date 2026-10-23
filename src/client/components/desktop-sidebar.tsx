"use client";

/**
 * Global sidebar for the redesigned shell (design-spec §3, §7).
 *
 * Top to bottom: the Routa logo with the collapse button, the "Workspaces /
 * All projects" row, ten top-level entries (Home, Needs you, Board, Sessions,
 * Team, Spec, Feature explorer, Harness, Fluency, Settings), the collapsible
 * Resources and Developer groups (shell/sidebar-nav-groups.tsx), and the
 * Projects group listing every workspace (shell/sidebar-projects.tsx), which
 * scrolls on its own so nothing above it leaves the viewport.
 *
 * Widths follow §7 and the prototype breakpoints: 216px above 1100px,
 * 184px from 801 to 1100px, and an off-canvas drawer at ≤800px opened
 * from the top-left menu button. Above 800px the sidebar can collapse to a
 * 56px icon rail (remembered, see shell/use-sidebar-collapsed.ts); the
 * drawer always opens at full width with labels.
 */

import React, { useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

import { useTranslation } from "@/i18n";
import { buildShellNavItems, isShellNavActive } from "./shell/shell-nav-items";
import { SidebarNavGroups } from "./shell/sidebar-nav-groups";
import { SidebarAllProjectsRow, SidebarProjects } from "./shell/sidebar-projects";

interface DesktopSidebarProps {
  workspaceId?: string | null;
  /** Narrow-screen drawer state; ignored above the drawer breakpoint. */
  drawerOpen?: boolean;
  onDrawerClose?: () => void;
  /** Wide-screen icon rail; never applies to the narrow-screen drawer. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

const COLLAPSE_ICON_PATH = "M13.5 4.5 6 12l7.5 7.5M18 4.5 10.5 12 18 19.5";
const EXPAND_ICON_PATH = "M10.5 4.5 18 12l-7.5 7.5M6 4.5 13.5 12 6 19.5";

export function DesktopSidebar({
  workspaceId,
  drawerOpen = false,
  onDrawerClose,
  collapsed = false,
  onToggleCollapsed,
}: DesktopSidebarProps) {
  const pathname = usePathname() ?? "/";
  const { t } = useTranslation();
  const items = buildShellNavItems(t, workspaceId);
  const asideRef = useRef<HTMLElement>(null);
  // The drawer always shows labels; the icon rail only applies to the docked sidebar.
  const compact = collapsed && !drawerOpen;
  const toggleLabel = collapsed ? t.nav.openSidebar : t.nav.closeSidebar;

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onDrawerClose?.();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    asideRef.current?.querySelector<HTMLElement>("a")?.focus();
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen, onDrawerClose]);

  return (
    <>
      {drawerOpen ? (
        <div
          aria-hidden="true"
          data-testid="desktop-shell-drawer-backdrop"
          className="fixed inset-0 z-40 bg-canvas/70 min-[801px]:hidden"
          onClick={onDrawerClose}
        />
      ) : null}
      <aside
        ref={asideRef}
        id="routa-shell-sidebar"
        data-testid="desktop-shell-sidebar"
        data-drawer-open={drawerOpen ? "true" : "false"}
        data-collapsed={compact ? "true" : "false"}
        className={`flex h-full shrink-0 flex-col gap-3 overflow-hidden border-r border-default bg-sidebar pb-3 pt-4 text-primary
          max-[800px]:fixed max-[800px]:inset-y-0 max-[800px]:z-50 max-[800px]:w-[230px] max-[800px]:px-3 max-[800px]:transition-transform max-[800px]:duration-[180ms] max-[800px]:motion-reduce:transition-none
          ${drawerOpen ? "max-[800px]:translate-x-0 max-[800px]:shadow-overlay" : "max-[800px]:-translate-x-full"}
          ${compact ? "min-[801px]:w-14 min-[801px]:px-2" : "min-[801px]:w-[184px] min-[801px]:px-3 min-[1101px]:w-[216px]"}`}
      >
        <div className={`flex shrink-0 items-center gap-1 ${compact ? "flex-col" : "justify-between"}`}>
          {compact ? null : (
            <Link href="/" className="flex min-w-0 items-center gap-2 rounded-control px-2.5 py-1 text-[13px] font-semibold text-primary" title="Routa">
              <Image src="/logo.svg" alt="" width={18} height={18} className="rounded-md" />
              <span>Routa</span>
            </Link>
          )}
          <button
            type="button"
            data-testid="desktop-shell-sidebar-toggle"
            onClick={onToggleCollapsed}
            title={toggleLabel}
            aria-label={toggleLabel}
            aria-expanded={!collapsed}
            aria-controls="routa-shell-sidebar"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-secondary transition-colors duration-150 motion-reduce:transition-none hover:bg-hover hover:text-primary focus-visible:outline-2 focus-visible:outline-accent max-[800px]:hidden"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-4 w-4">
              <path d={collapsed ? EXPAND_ICON_PATH : COLLAPSE_ICON_PATH} />
            </svg>
          </button>
        </div>

        <SidebarAllProjectsRow t={t} workspaceId={workspaceId} compact={compact} onNavigate={onDrawerClose} />

        <nav aria-label={t.shell.nav.label} className="flex shrink-0 flex-col gap-0.5">
          {items.map((item) => {
            const active = isShellNavActive(item, pathname);
            return (
              <Link
                key={item.id}
                href={item.href}
                data-nav-id={item.id}
                title={item.label}
                aria-label={compact ? item.label : undefined}
                aria-current={active ? "page" : undefined}
                onClick={onDrawerClose}
                className={`flex min-h-[35px] items-center rounded-md py-1.5 text-xs transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-accent ${
                  compact ? "justify-center" : "gap-2.5 px-2.5"
                } ${active ? "bg-accent-subtle text-primary" : "text-secondary hover:bg-hover hover:text-primary"}`}
              >
                {item.icon}
                {compact ? null : <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}
          {compact ? null : (
            <SidebarNavGroups t={t} workspaceId={workspaceId} pathname={pathname} onNavigate={onDrawerClose} />
          )}
        </nav>

        <SidebarProjects t={t} workspaceId={workspaceId} pathname={pathname} compact={compact} onNavigate={onDrawerClose} />
      </aside>
    </>
  );
}
