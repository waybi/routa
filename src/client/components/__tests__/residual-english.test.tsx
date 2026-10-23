/**
 * Residual English (card 7, AC11): the strings the boss saw in English on
 * the Chinese UI now come from the dictionary — Chinese under zh, the
 * original English under en.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/i18n";
import { LOCALE_STORAGE_KEY } from "@/i18n/types";

import { SettingsPanel } from "../settings-panel";
import { ModelDropdown } from "../chat-panel/components/model-dropdown";
import { LeftSidebar } from "@/app/workspace/[workspaceId]/sessions/[sessionId]/left-sidebar";
import { KanbanCardActivityBar } from "@/app/workspace/[workspaceId]/kanban/kanban-card-activity";
import { createDetailTask } from "@/app/workspace/[workspaceId]/kanban/__tests__/kanban-detail-fixtures";

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));

vi.mock("@/client/utils/diagnostics", async () => {
  const actual = await vi.importActual<typeof import("@/client/utils/diagnostics")>("@/client/utils/diagnostics");
  return { ...actual, desktopAwareFetch: mockFetch };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/settings",
  useParams: () => ({}),
}));
vi.mock("@/client/components/session-context-panel", () => ({ SessionContextPanel: () => null }));

function withLocale(locale: "en" | "zh", node: React.ReactNode) {
  localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  return render(<I18nProvider>{node}</I18nProvider>);
}

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockImplementation(async () => new Response(JSON.stringify({}), { status: 200 }));
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const EXPECTED = {
  zh: {
    providersTitle: "供应商",
    providersDescription: "管理检测到的 ACP 执行器、安装更多施工者、隐藏不需要的条目，并配置各执行器的凭证。",
    quickAccess: "快捷入口",
    openTasks: "打开任务",
    defaultModel: "默认模型",
    filter: "筛选模型...",
    hidePane: "隐藏会话面板",
  },
  en: {
    providersTitle: "Providers",
    providersDescription:
      "Manage detected ACP providers, install additional agents, hide noisy entries, and configure provider-specific credentials.",
    quickAccess: "Quick Access",
    openTasks: "Open Tasks",
    defaultModel: "Default model",
    filter: "Filter models...",
    hidePane: "Hide session pane",
  },
} as const;

function sidebar() {
  return (
    <LeftSidebar
      isCollapsed={false}
      onToggleCollapse={vi.fn()}
      width={320}
      showMobileSidebar={false}
      onResizeStart={vi.fn()}
      sessionId="s-1"
      workspaceId="default"
      refreshKey={0}
      onSelectSession={vi.fn()}
      onCreateSession={vi.fn()}
      codebases={[]}
      repoSelection={null}
      hasProviders
      hasSelectedProvider
      routaTasks={[{ id: "t-1", title: "Task one", status: "pending" } as never]}
      onConfirmAllTasks={vi.fn()}
      onExecuteAllTasks={vi.fn()}
      onConfirmTask={vi.fn()}
      onEditTask={vi.fn()}
      onExecuteTask={vi.fn(async () => null)}
      concurrency={1}
      onConcurrencyChange={vi.fn()}
      hasCollabNotes={false}
      sessionNotes={[]}
      notesConnected
      onUpdateNote={vi.fn(async () => null)}
      onDeleteNote={vi.fn(async () => {})}
      onExecuteNoteTask={vi.fn(async () => null)}
      onExecuteQuickAccessNoteTask={vi.fn(async () => null)}
      onExecuteAllNoteTasks={vi.fn(async () => {})}
      onExecuteSelectedNoteTasks={vi.fn(async () => {})}
      crafterAgents={[]}
      onSelectNoteTask={vi.fn()}
    />
  );
}

describe.each(["zh", "en"] as const)("residual English cleared (%s)", (locale) => {
  const expected = EXPECTED[locale];

  it("Settings › Providers title and description", () => {
    withLocale(locale, <SettingsPanel open onClose={vi.fn()} providers={[]} initialTab="providers" variant="page" />);
    const description = screen.getByTestId("settings-providers-description");
    expect(description.textContent?.trim()).toBe(expected.providersDescription);
    expect(description.previousElementSibling?.textContent).toBe(expected.providersTitle);
  });

  it("session sidebar quick access", () => {
    withLocale(locale, sidebar());
    expect(screen.getByTestId("session-quick-access").textContent).toContain(expected.quickAccess);
    expect(screen.getByRole("button", { name: expected.openTasks })).toBeTruthy();
  });

  it("model dropdown default label and filter", async () => {
    withLocale(locale, <ModelDropdown selectedModel="" onModelChange={vi.fn()} onFetchModels={async () => []} />);
    const trigger = screen.getByText(expected.defaultModel);
    fireEvent.click(trigger);
    expect(await screen.findByPlaceholderText(expected.filter)).toBeTruthy();
  });

  it("card detail activity bar hide-pane button", async () => {
    mockFetch.mockImplementation(async () => new Response(JSON.stringify({ runs: [] }), { status: 200 }));
    const task = createDetailTask("task-hide", "Hide pane", {
      laneSessions: [{ sessionId: "session-1", columnName: "Dev", status: "running", startedAt: "2025-01-01T00:00:00.000Z" }],
      triggerSessionId: "session-1",
    });
    withLocale(
      locale,
      <KanbanCardActivityBar task={task} specialistLanguage={locale === "zh" ? "zh-CN" : "en"} onCloseSession={vi.fn()} />,
    );
    expect(await screen.findByRole("button", { name: expected.hidePane })).toBeTruthy();
  });
});
