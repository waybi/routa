"use client";

import Link from "next/link";

import { useTranslation } from "@/i18n";
import { SETTINGS_NAV_GROUPS } from "./settings-center-nav";

/**
 * The /settings overview (design-spec §5): one card per settings group
 * (build / integrations / automation / quality). Each row is the page name,
 * a one-line explanation and a "Configure" link. Groups and links come from
 * SETTINGS_NAV_GROUPS so the cards and the left sub-navigation stay in step.
 */
export function SettingsOverviewCards() {
  const { t } = useTranslation();
  const nav = t.shell.settingsNav;
  const copy = t.settingsRedesign.overview;
  const groups = SETTINGS_NAV_GROUPS.filter(({ group }) => group !== "overview");

  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="settings-overview-cards">
      {groups.map(({ group, items }) => (
        <section
          key={group}
          aria-labelledby={`settings-overview-${group}`}
          data-testid={`settings-overview-card-${group}`}
          className="rounded-lg border border-default bg-surface"
        >
          <h2 id={`settings-overview-${group}`} className="m-0 border-b border-default px-4 py-2.5 text-sm font-semibold text-primary">
            {nav.groups[group]}
          </h2>
          <ul className="m-0 list-none divide-y divide-[var(--line)] p-0">
            {items.map((item) => {
              const key = item.key as Exclude<typeof item.key, "overview">;
              return (
                <li key={item.key} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-[13px] font-medium text-primary">{nav.items[item.key]}</p>
                    <p className="m-0 mt-0.5 text-xs text-secondary">{copy.items[key]}</p>
                  </div>
                  <Link
                    href={item.href}
                    data-testid={`settings-overview-link-${item.key}`}
                    aria-label={`${copy.configure} ${nav.items[item.key]}`}
                    className="shrink-0 rounded-md border border-default px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    {copy.configure}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
