import { cleanup, render, screen, within } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/i18n";
import { LOCALE_STORAGE_KEY } from "@/i18n/types";
import en from "@/i18n/locales/en";
import zh from "@/i18n/locales/zh";
import { assertDirectlyVisible } from "@/client/components/__tests__/direct-visibility";

/**
 * Card 11 (Routa redesign gap 11), R18: the schedules page header shows the
 * "Trigger: Cron-driven automation" and "Runtime: Background execution"
 * pills again (e4e5c162 settings/schedules/page.tsx L56-59) next to the
 * tick endpoint pill; the webhooks header is unchanged (E1).
 */

const pathnameState = vi.hoisted(() => ({ pathname: "/settings/schedules" }));
vi.mock("next/navigation", () => ({
  usePathname: () => pathnameState.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/client/components/desktop-app-shell", () => ({
  DesktopAppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/client/components/workspace-switcher", () => ({ WorkspaceSwitcher: () => null }));
vi.mock("@/client/components/schedule-panel", () => ({ SchedulePanel: () => <div data-testid="schedule-panel" /> }));
vi.mock("@/client/components/github-webhook-panel", () => ({ GitHubWebhookPanel: () => <div data-testid="github-webhook-panel" /> }));
vi.mock("@/client/hooks/use-workspaces", () => ({
  useWorkspaces: () => ({ workspaces: [{ id: "default", title: "Default" }], loading: false, createWorkspace: vi.fn(async () => null) }),
}));

import SchedulesSettingsPage from "../page";
import WebhookSettingsPage from "../../webhooks/page";

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(LOCALE_STORAGE_KEY);
});

describe("schedules header pills (R18 / AC8, C6c)", () => {
  it.each([
    ["en", en],
    ["zh", zh],
  ] as const)("shows tick, trigger and runtime pills in the header in %s", (locale, dict) => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    pathnameState.pathname = "/settings/schedules";
    render(<I18nProvider><SchedulesSettingsPage /></I18nProvider>);
    const actions = screen.getByTestId("settings-page-header-actions");
    const tick = within(actions).getByTestId("schedules-tick-pill");
    const trigger = within(actions).getByTestId("schedules-trigger-pill");
    const runtime = within(actions).getByTestId("schedules-runtime-pill");
    expect(tick.textContent).toContain("/api/schedules/tick");
    expect(trigger.textContent).toBe(`${dict.settingsExtended.triggerLabel}${dict.settingsExtended.triggerValue}`);
    expect(runtime.textContent).toBe(`${dict.settingsExtended.runtimeLabel}${dict.settingsExtended.runtimeValue}`);
    expect(screen.getByTestId("schedules-header-pills").className.split(/\s+/)).toContain("flex-wrap");
    for (const [name, element] of [["tick", tick], ["trigger", trigger], ["runtime", runtime]] as const) {
      assertDirectlyVisible(element, `${name} pill`);
    }
  });

  it("leaves the webhooks header as it was (Webhook URL pill only)", () => {
    pathnameState.pathname = "/settings/webhooks";
    render(<I18nProvider><WebhookSettingsPage /></I18nProvider>);
    const actions = screen.getByTestId("settings-page-header-actions");
    expect(actions.textContent).toBe(`${en.settings.webhookUrl}/api/webhooks/github`);
  });
});
