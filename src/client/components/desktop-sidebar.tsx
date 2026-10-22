"use client";

/**
 * Global sidebar for the redesigned shell (design-spec §3, §7).
 *
 * Exactly seven entries: Home, Needs you, Board, Sessions, Team, Spec,
 * Settings. Workspace switching lives in the top bar; settings sub-pages
 * live in the settings sub-navigation.
 *
 * Widths follow §7 and the prototype breakpoints: 216px above 1100px,
 * 184px from 801 to 1100px, and an off-canvas drawer at ≤800px opened
 * from the top-left menu button.
 */

import React, { useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

import { useTranslation } from "@/i18n";
import { buildShellNavItems, isShellNavActive } from "./shell/shell-nav-items";

interface DesktopSidebarProps {
  workspaceId?: string | null;
  /** Narrow-screen drawer state; ignored above the drawer breakpoint. */
  drawerOpen?: boolean;
  onDrawerClose?: () => void;
}

export function DesktopSidebar({ workspaceId, drawerOpen = false, onDrawerClose }: DesktopSidebarProps) {
  const pathname = usePathname() ?? "/";
  const { t } = useTranslation();
  const items = buildShellNavItems(t, workspaceId);
  const asideRef = useRef<HTMLElement>(null);

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
        className={`flex h-full shrink-0 flex-col gap-4 border-r border-default bg-sidebar px-3 pb-3 pt-4 text-primary
          max-[800px]:fixed max-[800px]:inset-y-0 max-[800px]:z-50 max-[800px]:w-[230px] max-[800px]:transition-transform max-[800px]:duration-[180ms] max-[800px]:motion-reduce:transition-none
          ${drawerOpen ? "max-[800px]:translate-x-0 max-[800px]:shadow-overlay" : "max-[800px]:-translate-x-full"}
          min-[801px]:w-[184px] min-[1101px]:w-[216px]`}
      >
        <Link href="/" className="flex items-center gap-2 rounded-control px-2.5 py-1 text-[13px] font-semibold text-primary" title="Routa">
          <Image src="/logo.svg" alt="" width={18} height={18} className="rounded-md" />
          <span>Routa</span>
        </Link>

        <nav aria-label={t.shell.nav.label} className="flex flex-col gap-0.5">
          {items.map((item) => {
            const active = isShellNavActive(item, pathname);
            return (
              <Link
                key={item.id}
                href={item.href}
                data-nav-id={item.id}
                aria-current={active ? "page" : undefined}
                onClick={onDrawerClose}
                className={`flex min-h-[35px] items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-accent ${
                  active ? "bg-accent-subtle text-primary" : "text-secondary hover:bg-hover hover:text-primary"
                }`}
              >
                {item.icon}
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
