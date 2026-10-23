"use client";

/**
 * Desktop Navigation Rail — icon-only variant of the global navigation.
 *
 * Shares the seven entries (and icons) with the sidebar so the two can
 * never drift apart.
 */

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useTranslation } from "@/i18n";
import { buildShellNavItems, isShellNavActive } from "./shell/shell-nav-items";
import { InboxNavBadge } from "./shell/inbox-nav-badge";

interface DesktopNavRailProps {
  workspaceId: string;
}

export function DesktopNavRail({ workspaceId }: DesktopNavRailProps) {
  const pathname = usePathname() ?? "/";
  const { t } = useTranslation();
  const items = buildShellNavItems(t, workspaceId);

  return (
    <aside
      className="flex h-full w-12 shrink-0 flex-col border-r border-default bg-sidebar"
      data-testid="desktop-nav-rail"
    >
      <nav aria-label={t.shell.nav.label} className="flex flex-1 flex-col items-center gap-0.5 py-2">
        {items.map((item) => {
          const active = isShellNavActive(item, pathname);
          return (
            <Link
              key={item.id}
              href={item.href}
              title={item.label}
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              className={`relative flex h-9 w-9 items-center justify-center rounded-md transition-colors duration-150 motion-reduce:transition-none ${
                active ? "bg-accent-subtle text-primary" : "text-secondary hover:bg-hover hover:text-primary"
              }`}
            >
              {item.icon}
              {item.id === "inbox" ? <InboxNavBadge workspaceId={workspaceId} variant="rail" /> : null}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
