import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/i18n";
import { LOCALE_STORAGE_KEY } from "@/i18n/types";
import en from "@/i18n/locales/en";
import zh from "@/i18n/locales/zh";
import { assertDirectlyVisible } from "@/client/components/__tests__/direct-visibility";
import { resetKanbanModelTiersCache } from "@/client/kanban-model-tiers/use-kanban-model-tiers";
import { resetModelEffortChoicesCache } from "@/client/model-effort/use-model-effort-choices";

/**
 * Card a4345457: the specialists panel sits below the Kanban model tiers card.
 * Its wrapper must have a definite height that does not follow the leftover
 * viewport height, otherwise the editor (min 480px) overflows the panel and the
 * blue status bar is drawn across the list. jsdom has no layout, so this locks
 * the class contract; the geometry is checked by the Playwright judge on the card.
 */

const { desktopAwareFetch } = vi.hoisted(() => ({ desktopAwareFetch: vi.fn() }));
vi.mock("@/client/utils/diagnostics", () => ({ desktopAwareFetch }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/settings/specialists",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/client/components/desktop-app-shell", () => ({
  DesktopAppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import SpecialistsSettingsPage from "../page";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const tier = { override: null, codeDefault: "claude-opus-5-5", effective: "claude-opus-5-5", reasoningEffort: { override: null, effective: null } };

beforeEach(() => {
  resetKanbanModelTiersCache();
  resetModelEffortChoicesCache();
  desktopAwareFetch.mockReset();
  desktopAwareFetch.mockImplementation(async (input: string) => {
    const url = String(input);
    if (url === "/api/specialists") {
      return json({
        specialists: [{
          id: "frontend-dev",
          name: "Frontend Dev",
          description: "Builds UI flows",
          role: "DEVELOPER",
          defaultModelTier: "BALANCED",
          systemPrompt: "Focus on compact UI delivery.",
          roleReminder: "Keep density high.",
          source: "user",
          model: "gpt-5.4",
        }],
      });
    }
    if (url.includes("/kanban/model-tiers")) {
      return json({ providerId: "dsh", tiers: { fast: tier, balanced: tier, smart: tier }, specialists: [] });
    }
    if (url.includes("/config-options")) return json({ configOptions: [] });
    throw new Error(`Unexpected fetch: ${url}`);
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(LOCALE_STORAGE_KEY);
});

async function renderPage(locale: "zh" | "en") {
  window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  render(<I18nProvider><SpecialistsSettingsPage /></I18nProvider>);
  await waitFor(() => expect(screen.getByText("Frontend Dev")).toBeTruthy());
  return screen.getByTestId("specialists-tab-root");
}

describe("SpecialistsSettingsPage layout (card a4345457)", () => {
  it("gives the specialists panel a definite, non-shrinking height and lets the page scroll", async () => {
    const root = await renderPage("zh");
    const wrapper = root.parentElement!;
    const wrapperClasses = wrapper.className.split(/\s+/);
    // Definite height decoupled from the leftover viewport height, never compressed by the tiers card.
    expect(wrapperClasses).toContain("h-[max(640px,calc(100dvh-9rem))]");
    expect(wrapperClasses).toContain("shrink-0");
    expect(wrapperClasses).not.toContain("flex-1");
    // Below lg the two panes stack at their own minimum heights and the page scrolls.
    expect(wrapperClasses).toContain("max-lg:h-auto");

    const scroller = wrapper.parentElement!;
    expect(scroller.className.split(/\s+/)).toContain("overflow-y-auto");
    expect(scroller.contains(screen.getByTestId("kanban-model-tiers-card"))).toBe(true);
  });

  it.each([
    ["zh", zh],
    ["en", en],
  ] as const)("keeps every block of the page rendered and directly visible in %s", async (locale, dict) => {
    const root = await renderPage(locale);
    const card = screen.getByTestId("kanban-model-tiers-card");
    const catalogList = screen.getByTestId("specialists-tab-catalog-list");
    const search = screen.getByPlaceholderText(dict.settings.specialistsTab.searchPlaceholder);
    const editor = screen.getByTestId("specialists-tab-editor");
    const promptField = within(editor).getByPlaceholderText(dict.sessionDetailRedesign.settings.specialistPromptPlaceholder);
    const inspector = within(editor).getByText(dict.sessionDetailRedesign.settings.inspector).closest("aside");
    const statusBar = root.lastElementChild;

    expect(statusBar?.className.split(/\s+/)).toContain("bg-desktop-accent");
    for (const [name, element] of [
      ["kanban model tiers card", card],
      ["specialist list", catalogList],
      ["search filter", search],
      ["editor form", promptField],
      ["status bar", statusBar],
    ] as const) {
      assertDirectlyVisible(element, name);
    }
    // The inspector keeps its pre-existing xl-only responsive rule; it must not be folded away.
    expect(inspector).not.toBeNull();
    expect(inspector!.closest('details,[hidden],[aria-hidden="true"]')).toBeNull();
    expect(inspector!.className.split(/\s+/)).toContain("xl:flex");
  });
});
