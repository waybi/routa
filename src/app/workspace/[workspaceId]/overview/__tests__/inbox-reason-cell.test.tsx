/** Card 7fbfba57 C4/C5/C7: the two-line reason cell with an expandable full comment. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n";
import { LOCALE_STORAGE_KEY } from "@/i18n/types";
import { buttonClassName } from "@/client/components/ui/button";
import type { TaskInfo } from "../../types";
import { buildWorkspaceInbox, inboxRowView } from "../inbox-rules";
import { INBOX_SOURCE_MAX_CHARS, InboxRowItem } from "../inbox-row";
import { NOW } from "./inbox-fixtures";
import { blockedCard, comment, resolverBoard } from "./handler-fixtures";

function renderBlocked(body: string, overrides: Partial<TaskInfo> = {}) {
  const board = resolverBoard();
  const task = blockedCard("a", { attentionResolution: undefined, comments: [comment("c", body, new Date(NOW - 3600_000).toISOString())], ...overrides });
  const [row] = buildWorkspaceInbox({ id: "w1", title: "W" }, [task], [board], NOW, () => []).active;
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  render(
    <I18nProvider>
      <InboxRowItem row={row} now={NOW} dismissed={false} showWorkspace onToggleDismiss={vi.fn()} view={inboxRowView(row, board)} />
    </I18nProvider>,
  );
  return fetchMock;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("reason cell", () => {
  it("(a) shows why and decision on two lines, expands and collapses without fetching", () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh");
    const body = "阻塞原因：上线前有一项老检查没过，不是这张卡的问题\n要你定：先撤掉别人的改动，还是等它合并完再上\n\n## 细节\n- 详情";
    const fetchMock = renderBlocked(body);
    const why = screen.getByTestId("inbox-row-reason-why");
    expect(why.firstChild?.textContent).toBe("上线前有一项老检查没过，不是这张卡的问题");
    expect(why.textContent).not.toMatch(/阻塞原因|为什么挡住|：$/u);
    expect(screen.getByTestId("inbox-row-reason-decision").textContent).toBe("要你定：先撤掉别人的改动，还是等它合并完再上");
    expect(screen.getByTestId("inbox-row-reason").querySelector("dd")!.getAttribute("title")).toBe(body);
    const toggle = screen.getByTestId("inbox-row-reason-toggle");
    expect(toggle.textContent).toBe("展开全文");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("type")).toBe("button");
    expect(toggle.className).toContain(buttonClassName("ghost", "xs"));
    fireEvent.click(toggle);
    const pre = screen.getByTestId("inbox-row-reason-full");
    expect(pre.textContent).toBe(body);
    expect(pre.tagName).toBe("PRE");
    for (const cls of ["whitespace-pre-wrap", "break-words", "overflow-auto", "max-h-64", "border-default", "bg-canvas"]) expect(pre.className).toContain(cls);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.textContent).toBe("收起");
    fireEvent.click(toggle);
    expect(screen.queryByTestId("inbox-row-reason-full")).toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("(b) renders one line when there is no decision", () => {
    renderBlocked("阻塞原因：只有原因");
    expect(screen.getByTestId("inbox-row-reason-why")).toBeTruthy();
    expect(screen.queryByTestId("inbox-row-reason-decision")).toBeNull();
  });

  it("(c) clips a long why to 160 chars; title keeps the whole comment", () => {
    const body = `阻塞原因：${"长".repeat(200)}\n要你定：定`;
    renderBlocked(body);
    expect(screen.getByTestId("inbox-row-reason-why").firstChild?.textContent).toBe(`${"长".repeat(INBOX_SOURCE_MAX_CHARS)}…`);
    expect(screen.getByTestId("inbox-row-reason").querySelector("dd")!.getAttribute("title")).toBe(body);
  });

  it("C5/C7 styling, English labels, no danger colours, no label prefix", () => {
    renderBlocked("Blocked because: A\nYou decide: B");
    const why = screen.getByTestId("inbox-row-reason-why");
    expect(why.firstChild?.textContent).toBe("A");
    expect(why.textContent).not.toMatch(/Why it is blocked|：/u);
    expect(screen.getByTestId("inbox-row-reason-decision").textContent).toBe("You decide: B");
    expect(screen.getByTestId("inbox-row-reason-toggle").textContent).toBe("Show full comment");
    expect(why.className).toBe("block font-semibold text-primary");
    expect(screen.getByTestId("inbox-row-reason-decision").className).toBe("block text-secondary");
    expect(screen.getByTestId("inbox-row-reason-toggle").className).toBe(`${buttonClassName("ghost", "xs")} ml-1.5 font-normal`);
    expect(screen.getByTestId("inbox-row-reason").innerHTML).not.toMatch(/text-danger|bg-red-|attention|#[0-9a-fA-F]{3,6}\b/u);
  });

  it("F2 lastSyncError rows keep their text and have no toggle", () => {
    renderBlocked("阻塞原因：A", { lastSyncError: "push rejected" });
    expect(screen.queryByTestId("inbox-row-reason-toggle")).toBeNull();
    expect(screen.getByTestId("inbox-row-reason").textContent).toContain("Blocked: push rejected");
  });
});
