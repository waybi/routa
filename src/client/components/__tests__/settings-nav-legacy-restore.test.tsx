import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/i18n";
import { LOCALE_STORAGE_KEY } from "@/i18n/types";
import en from "@/i18n/locales/en";
import zh from "@/i18n/locales/zh";

import { assertDirectlyVisible } from "./direct-visibility";

/**
 * Card 11 (Routa redesign gap 11), R14: the settings left nav again links
 * straight to the /settings in-page tabs providers / registry / roles /
 * models (e4e5c162 settings-center-nav.tsx L21-26) on every settings page,
 * and highlights exactly one entry.
 */

const pathnameState = vi.hoisted(() => ({ pathname: "/settings" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathnameState.pathname }));

import { SETTINGS_NAV_GROUPS, SettingsCenterNav, type SettingsNavItem } from "../settings-center-nav";
import { SettingsOverviewCards } from "../settings-overview-cards";

const TAB_LINKS = [
  ["providers", "/settings?tab=providers"],
  ["registry", "/settings?tab=registry"],
  ["roles", "/settings?tab=roles"],
  ["models", "/settings?tab=models"],
] as const;

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(LOCALE_STORAGE_KEY);
});

function renderNav(pathname: string, activeItem?: SettingsNavItem) {
  pathnameState.pathname = pathname;
  return render(<I18nProvider><SettingsCenterNav activeItem={activeItem} /></I18nProvider>);
}

function navLinks(): HTMLElement[] {
  return within(screen.getByTestId("settings-center-nav")).getAllByRole("link");
}

function currentHrefs(): Array<string | null> {
  return navLinks().filter((link) => link.getAttribute("aria-current") === "page").map((link) => link.getAttribute("href"));
}

describe("settings nav direct links (R14 / AC6, C6)", () => {
  it.each([
    ["en", en],
    ["zh", zh],
  ] as const)("(a) /settings/schedules lists the four direct links right after Overview in %s", (locale, dict) => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    renderNav("/settings/schedules", "schedules");
    const hrefs = navLinks().map((link) => link.getAttribute("href"));
    expect(hrefs.slice(0, 5)).toEqual(["/settings", ...TAB_LINKS.map(([, href]) => href)]);
    const labels = { providers: dict.settings.providers, registry: dict.settings.registry, roles: dict.settings.roleDefaults, models: dict.settings.models };
    for (const [key, href] of TAB_LINKS) {
      const link = navLinks().find((element) => element.getAttribute("href") === href)!;
      expect(link.textContent).toBe(labels[key]);
      expect(link.getAttribute("data-settings-nav")).toBe(key);
      assertDirectlyVisible(link, `nav link ${key}`);
    }
    expect(currentHrefs()).toEqual(["/settings/schedules"]);
  });

  it.each(TAB_LINKS)("(b) on /settings with activeItem=%s only %s is current", (key, href) => {
    renderNav("/settings", key);
    expect(currentHrefs()).toEqual([href]);
    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  it("keeps the old shapes: no tab highlights Overview, webhooks highlights the automation Webhook entry", () => {
    renderNav("/settings");
    expect(currentHrefs()).toEqual(["/settings"]);
    cleanup();
    renderNav("/settings", "webhooks");
    expect(currentHrefs()).toEqual(["/settings/webhooks"]);
  });

  it("does not add the direct links to the overview cards (same 4 cards / 10 links as before)", () => {
    render(<I18nProvider><SettingsOverviewCards /></I18nProvider>);
    const cards = screen.getAllByTestId(/^settings-overview-card-/);
    expect(cards).toHaveLength(4);
    expect(within(screen.getByTestId("settings-overview-cards")).getAllByRole("link")).toHaveLength(10);
    expect(screen.queryByText(en.settings.roleDefaults)).toBeNull();
  });
});

// Every page that renders SettingsCenterNav (git grep -l SettingsCenterNav /
// SettingsFrame / SettingsRouteShell) with the activeItem it passes.
const PAGES: ReadonlyArray<[string, SettingsNavItem | undefined]> = [
  ["/settings", "providers"],
  ["/settings/agents", undefined],
  ["/settings/specialists", "specialists"],
  ["/settings/workflows", "workflows"],
  ["/settings/mcp", "mcp"],
  ["/mcp-tools", "mcpTools"],
  ["/settings/schedules", "schedules"],
  ["/settings/webhooks", "webhooks"],
  ["/settings/harness", "harness"],
  ["/settings/fitness", undefined],
  ["/settings/fluency", "fluency"],
];

describe("direct links on every settings page path (F4)", () => {
  it.each(PAGES)("%s (activeItem=%s) shows the four direct links, directly visible", (pathname, activeItem) => {
    renderNav(pathname, activeItem);
    for (const [key, href] of TAB_LINKS) {
      const link = navLinks().find((element) => element.getAttribute("href") === href);
      assertDirectlyVisible(link, `nav link ${key} on ${pathname}`);
    }
    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });
});

describe("highlight cross-check over every combination (F3a)", () => {
  const allHrefs = [...SETTINGS_NAV_GROUPS.flatMap(({ items }) => items.map((item) => item.href)), ...TAB_LINKS.map(([, href]) => href)];
  const pathnames = [...new Set(allHrefs.map((href) => href.split("?")[0]))];
  const activeItems: Array<SettingsNavItem | undefined> = [undefined, "providers", "registry", "roles", "models", "webhooks"];

  /** Expected current href, written from the requirement. */
  function judge(pathname: string, activeItem: SettingsNavItem | undefined): string {
    // /mcp-tools is always its own entry (it redirects to the MCP tools tab).
    if (pathname === "/mcp-tools") return "/mcp-tools";
    if (pathname === "/settings") {
      const tab = TAB_LINKS.find(([key]) => key === activeItem);
      if (tab) return tab[1];
      if (activeItem === "webhooks") return "/settings/webhooks";
      return "/settings";
    }
    // Sub-pages: an explicit page key (only "webhooks" in this set) wins, else the page itself.
    if (activeItem === "webhooks") return "/settings/webhooks";
    return pathname;
  }

  it(`${pathnames.length} paths x ${activeItems.length} activeItems: exactly one current entry, as judged`, () => {
    expect(pathnames.length).toBe(11);
    let checked = 0;
    for (const pathname of pathnames) {
      for (const activeItem of activeItems) {
        const view = renderNav(pathname, activeItem);
        const current = currentHrefs();
        expect(current, `${pathname} + ${activeItem}`).toEqual([judge(pathname, activeItem)]);
        view.unmount();
        checked += 1;
      }
    }
    expect(checked).toBe(66);
  });
});
