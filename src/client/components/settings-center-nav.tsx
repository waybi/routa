"use client";

/**
 * Settings sub-navigation (design-spec §3: "设置采用页内左侧二级导航").
 *
 * Eleven entries: the /settings overview, nine settings sub-pages and
 * /mcp-tools, grouped as in the spec. Highlight follows the current path;
 * the legacy `activeItem` prop is still accepted so the overview page's
 * in-page tabs (providers, models, …) highlight the overview entry.
 * None of these entries appear in the global sidebar.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useTranslation } from "@/i18n";
import type { SettingsTab } from "./settings-panel-shared";

export type SettingsNavKey =
  | "overview"
  | "agents"
  | "specialists"
  | "workflows"
  | "mcp"
  | "mcpTools"
  | "schedules"
  | "webhooks"
  | "harness"
  | "fitness"
  | "fluency";

/** Legacy names accepted by older call sites. */
export type SettingsNavItem = SettingsTab | SettingsNavKey;

type GroupKey = "overview" | "build" | "integrations" | "automation" | "quality";

export const SETTINGS_NAV_GROUPS: ReadonlyArray<{ group: GroupKey; items: ReadonlyArray<{ key: SettingsNavKey; href: string }> }> = [
  { group: "overview", items: [{ key: "overview", href: "/settings" }] },
  {
    group: "build",
    items: [
      { key: "agents", href: "/settings/agents" },
      { key: "specialists", href: "/settings/specialists" },
      { key: "workflows", href: "/settings/workflows" },
    ],
  },
  {
    group: "integrations",
    items: [
      { key: "mcp", href: "/settings/mcp" },
      { key: "mcpTools", href: "/mcp-tools" },
    ],
  },
  {
    group: "automation",
    items: [
      { key: "schedules", href: "/settings/schedules" },
      { key: "webhooks", href: "/settings/webhooks" },
    ],
  },
  {
    group: "quality",
    items: [
      { key: "harness", href: "/settings/harness" },
      { key: "fitness", href: "/settings/fitness" },
      { key: "fluency", href: "/settings/fluency" },
    ],
  },
];

const SETTINGS_TAB_KEYS: ReadonlySet<string> = new Set(["providers", "registry", "roles", "models"]);

/**
 * Resolves which entry is current. `/settings` itself always highlights the
 * overview (its in-page tabs pass names like "providers"); other pages may
 * pass `activeItem` (the MCP page passes "mcpTools" on its tools tab, which
 * is where /mcp-tools redirects); otherwise the path decides.
 */
export function resolveSettingsNavKey(pathname: string, activeItem?: SettingsNavItem): SettingsNavKey | null {
  if (pathname === "/mcp-tools") return "mcpTools";
  if (pathname === "/settings") return "overview";
  if (activeItem) {
    if (SETTINGS_TAB_KEYS.has(activeItem)) return "overview";
    return activeItem as SettingsNavKey;
  }
  for (const { items } of SETTINGS_NAV_GROUPS) {
    for (const item of items) {
      if (item.key !== "overview" && (pathname === item.href || pathname.startsWith(`${item.href}/`))) {
        return item.key;
      }
    }
  }
  return null;
}

interface SettingsCenterNavProps {
  activeItem?: SettingsNavItem;
}

export function SettingsCenterNav({ activeItem }: SettingsCenterNavProps) {
  const { t } = useTranslation();
  const pathname = usePathname() ?? "/settings";
  const current = resolveSettingsNavKey(pathname, activeItem);
  const copy = t.shell.settingsNav;

  return (
    <nav
      aria-label={copy.label}
      data-testid="settings-center-nav"
      className="flex w-52 shrink-0 flex-col gap-4 overflow-y-auto border-r border-default bg-canvas px-3 py-5 max-[800px]:w-full max-[800px]:flex-row max-[800px]:gap-2 max-[800px]:overflow-x-auto max-[800px]:border-b max-[800px]:border-r-0 max-[800px]:py-2"
    >
      {SETTINGS_NAV_GROUPS.map(({ group, items }) => (
        <div key={group} className="max-[800px]:flex max-[800px]:shrink-0 max-[800px]:gap-1">
          <p className="m-0 px-2.5 pb-1 text-[11px] text-secondary max-[800px]:hidden">{copy.groups[group]}</p>
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0 max-[800px]:flex-row">
            {items.map((item) => {
              const active = current === item.key;
              return (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    data-settings-nav={item.key}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-8 items-center whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs transition-colors duration-150 motion-reduce:transition-none ${
                      active ? "bg-accent-subtle text-primary" : "text-secondary hover:bg-hover hover:text-primary"
                    }`}
                  >
                    {copy.items[item.key]}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
