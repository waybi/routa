/**
 * Card 4877583c: the Blocked lane's "Automation" toggle attaches the Blocked
 * Resolver (contract C5, C18, C31–C35, F2 other lanes, F4 settings paths).
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n";
import { LOCALE_STORAGE_KEY } from "@/i18n/types";
import en from "@/i18n/locales/en";
import { KanbanSettingsModal } from "../kanban-settings-modal";
import { getColumnWorkflowSummary, getDefaultAutomationForStage } from "../kanban-settings-modal-parts";
import { getBlockedResolverAutomation } from "../blocked-resolver-automation";
import type { KanbanSpecialistLanguage } from "../kanban-specialist-language";
import type { KanbanBoardInfo } from "../../types";

type Automation = NonNullable<KanbanBoardInfo["columns"][number]["automation"]>;

/** Shape read from the four live boards (steps + top-level mirror). */
const LIVE_RESOLVER: Automation = {
  enabled: true,
  transitionType: "entry",
  steps: [{ id: "blocked-resolver", transport: "acp", role: "CRAFTER", specialistId: "kanban-blocked-resolver", specialistName: "阻塞处理员", specialistLocale: "zh-CN" }],
  role: "CRAFTER",
  specialistId: "kanban-blocked-resolver",
  specialistName: "阻塞处理员",
  specialistLocale: "zh-CN",
};

const board: KanbanBoardInfo = {
  id: "board-1",
  workspaceId: "workspace-1",
  name: "Delivery Board",
  isDefault: true,
  sessionConcurrencyLimit: 2,
  columns: [
    { id: "review", name: "Review", position: 0, stage: "review" },
    { id: "blocked", name: "Blocked", position: 1, stage: "blocked" },
  ],
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
} as KanbanBoardInfo;

function renderModal(blocked: Automation | undefined, specialistLanguage: KanbanSpecialistLanguage = "en", extra: Record<string, Automation> = {}) {
  const onSave = vi.fn(async () => {});
  render(
    <I18nProvider>
      <KanbanSettingsModal
        board={board}
        columnAutomation={{ ...(blocked ? { blocked } : {}), ...extra }}
        availableProviders={[{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude" }]}
        specialists={[]}
        specialistLanguage={specialistLanguage}
        onClose={vi.fn()}
        onClearAll={vi.fn(async () => {})}
        onSave={onSave}
      />
    </I18nProvider>,
  );
  return onSave;
}

function selectColumn(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

async function save(onSave: ReturnType<typeof vi.fn>): Promise<Record<string, Automation>> {
  fireEvent.click(screen.getByRole("button", { name: /save board settings/i }));
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  return (onSave.mock.calls[0] as unknown[])[1] as Record<string, Automation>;
}

function blockedToggle(): HTMLInputElement {
  return screen.getByRole("checkbox", { name: /toggle automation for blocked/i }) as HTMLInputElement;
}

afterEach(() => {
  window.localStorage.clear();
});

describe("Blocked lane automation toggle (C5, AC6)", () => {
  it("① off → on writes the resolver structure (en)", async () => {
    const onSave = renderModal({ enabled: false });
    selectColumn("Blocked");
    expect(blockedToggle().disabled).toBe(false);
    fireEvent.click(blockedToggle());
    const saved = (await save(onSave)).blocked;
    expect(saved.enabled).toBe(true);
    expect(saved.transitionType).toBe("entry");
    expect(saved.steps).toHaveLength(1);
    expect(saved.steps?.[0]).toMatchObject({ id: "blocked-resolver", role: "CRAFTER", specialistId: "kanban-blocked-resolver", specialistName: "Blocked Resolver" });
    expect(saved).toEqual(getBlockedResolverAutomation("en"));
  });

  it("⑤ zh-CN specialist language names the step 阻塞处理员 and matches the live boards' shape", async () => {
    const onSave = renderModal({ enabled: false }, "zh-CN");
    selectColumn("Blocked");
    fireEvent.click(blockedToggle());
    const saved = (await save(onSave)).blocked;
    expect(saved.steps?.[0]).toMatchObject({ id: "blocked-resolver", role: "CRAFTER", specialistId: "kanban-blocked-resolver", specialistName: "阻塞处理员" });
    expect(saved).toEqual(LIVE_RESOLVER);
  });

  it("② on → off writes exactly { enabled: false }", async () => {
    const onSave = renderModal(LIVE_RESOLVER);
    selectColumn("Blocked");
    expect(blockedToggle().checked).toBe(true);
    fireEvent.click(blockedToggle());
    expect((await save(onSave)).blocked).toEqual({ enabled: false });
  });

  it("③ an attached resolver survives saving after editing another lane", async () => {
    const onSave = renderModal(LIVE_RESOLVER, "zh-CN");
    selectColumn("Review");
    fireEvent.click(screen.getByRole("checkbox", { name: /toggle visibility for review/i }));
    const saved = await save(onSave);
    expect(saved.blocked).toEqual(LIVE_RESOLVER);
  });

  it("③' in an English UI the resolver stays enabled with the same step (locale follows the UI, as for every lane)", async () => {
    const onSave = renderModal(LIVE_RESOLVER, "en");
    selectColumn("Review");
    fireEvent.click(screen.getByRole("checkbox", { name: /toggle visibility for review/i }));
    const saved = (await save(onSave)).blocked;
    expect(saved.enabled).toBe(true);
    expect(saved.transitionType).toBe("entry");
    expect(saved.steps).toHaveLength(1);
    expect(saved.steps?.[0]).toMatchObject({ id: "blocked-resolver", role: "CRAFTER", specialistId: "kanban-blocked-resolver" });
  });

  it("④ untouched { enabled: false } stays { enabled: false }", async () => {
    const onSave = renderModal({ enabled: false });
    expect((await save(onSave)).blocked).toEqual({ enabled: false });
  });
});

describe("Blocked lane notes and status box (C5, C32–C35)", () => {
  it("off: manual-only status and note with the hint to turn it on", () => {
    renderModal({ enabled: false });
    selectColumn("Blocked");
    const status = screen.getByTestId("kanban-blocked-lane-status");
    expect(status.textContent).toBe(en.kanban.manualLaneOnly);
    expect(status.className.split(" ")).toEqual(expect.arrayContaining(["border-attention", "bg-attention-subtle", "text-attention"]));
    const note = screen.getByTestId("kanban-blocked-lane-note");
    expect(note.className).toBe("rounded-lg border border-default bg-subtle p-3");
    expect(note.textContent).toContain("Blocked is a manual-only lane.");
    expect(note.textContent).toContain(en.kanban.blockedResolverOffHint);
    expect(note.textContent).not.toContain(en.kanban.automationUnavailable);
  });

  it("on (zh): new status and note, info badge, no step editor and no Defaults button", () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh");
    renderModal({ enabled: false }, "zh-CN");
    selectColumn("Blocked");
    fireEvent.click(blockedToggle());
    const status = screen.getByTestId("kanban-blocked-lane-status");
    expect(status.textContent).toBe("已挂阻塞处理员");
    expect(status.className.split(" ")).toEqual(expect.arrayContaining(["border-success", "bg-success-subtle", "text-success"]));
    const note = screen.getByTestId("kanban-blocked-lane-note");
    expect(note.getAttribute("data-resolver")).toBe("on");
    expect(note.textContent).toContain("卡进 Blocked 后由阻塞处理员自动核对，只把需要你拍板的留给你");
    expect(within(note).getByText("阻塞处理员")).toBeTruthy();
    expect(screen.queryByText("默认值")).toBeNull();
    expect(screen.queryByTestId("kanban-settings-step-1-model-effort")).toBeNull();
    expect(screen.queryByText(/Defaults/)).toBeNull();
  });

  it("on (en): English note text", () => {
    renderModal(LIVE_RESOLVER);
    selectColumn("Blocked");
    expect(screen.getByTestId("kanban-blocked-lane-note").textContent).toContain(en.kanban.blockedResolverOnDesc);
    expect(screen.getByTestId("kanban-blocked-lane-status").textContent).toBe("Blocked Resolver attached");
  });

  it("keeps visibility toggle, move and delete controls on the Blocked lane (C47)", () => {
    renderModal(LIVE_RESOLVER);
    selectColumn("Blocked");
    expect(screen.getByRole("checkbox", { name: /toggle visibility for blocked/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Move Blocked up" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Move Blocked down" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Delete Blocked" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("pure defaults and summary (F2, C18)", () => {
  it("Blocked default stays { enabled: false }; other stages keep their defaults", () => {
    expect(getDefaultAutomationForStage("blocked", "en")).toEqual({ enabled: false });
    expect(getDefaultAutomationForStage("backlog", "en")).toMatchObject({ enabled: true, transitionType: "entry", autoAdvanceOnSuccess: true, steps: [{ id: "step-1", role: "CRAFTER", transport: "acp" }] });
    expect(getDefaultAutomationForStage("todo", "en")).toMatchObject({ enabled: true, transitionType: "entry", steps: [{ id: "step-1", role: "CRAFTER" }] });
    expect(getDefaultAutomationForStage("dev", "en")).toMatchObject({ enabled: true, transitionType: "entry", steps: [{ id: "step-1", role: "DEVELOPER" }] });
    expect(getDefaultAutomationForStage("review", "en")).toMatchObject({ enabled: true, transitionType: "exit", requiredArtifacts: ["screenshot", "test_results"], steps: [{ id: "step-1", role: "GATE" }] });
    expect(getDefaultAutomationForStage("done", "en")).toMatchObject({ enabled: true, transitionType: "entry", requiredArtifacts: ["code_diff"], steps: [{ specialistId: "kanban-done-reporter", role: "GATE" }] });
  });

  it("left summary: manual-only when off, the resolver when on", () => {
    const column = board.columns[1];
    expect(getColumnWorkflowSummary(column, { enabled: false }, [], [], undefined, "Auto", en)).toBe(en.kanban.manualLaneOnly);
    const on = getColumnWorkflowSummary(column, LIVE_RESOLVER, [], [], undefined, "Auto", en);
    expect(on).not.toBe(en.kanban.manualLaneOnly);
    expect(on).toContain("阻塞处理员");
  });
});
