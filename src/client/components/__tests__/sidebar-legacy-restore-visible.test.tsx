import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Boss rule (2026-10-23): whatever the old build (e4e5c162) let the user see
 * and click stays directly visible and usable. One case per item: S1–S9 are
 * the top-bar workspace switcher features (kept as-is, plus the sidebar
 * Projects group), R9–R13 the sidebar items restored by this card.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/workspace/ws-routa/kanban",
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("../shell-header-controls", () => ({
  ShellHeaderControls: () => <div data-testid="shell-header-controls" />,
}));

import { DesktopAppShell } from "../desktop-app-shell";
import { WorkspaceSwitcher } from "../workspace-switcher";
import type { WorkspaceData } from "../../hooks/use-workspaces";
import { resetSidebarNavGroupCache } from "../shell/sidebar-nav-groups";
import { resetSidebarWorkspacesCache } from "../shell/use-sidebar-workspaces";

const WORKSPACES: WorkspaceData[] = [
  { id: "default", title: "Default Workspace" },
  { id: "ws-topbi", title: "TopBI" },
  { id: "ws-routa", title: "Routa" },
  { id: "ws-dsh", title: "deepseek-harness" },
  { id: "ws-lt", title: "local-tools" },
  { id: "ws-turnilo", title: "turnilo" },
].map((workspace, index) => ({
  ...workspace,
  status: "active" as const,
  metadata: {},
  createdAt: new Date(Date.UTC(2026, 8, 1 + index)).toISOString(),
  updatedAt: new Date(Date.UTC(2026, 8, 1 + index)).toISOString(),
}));

const HIDING_CLASSES = [/(^|\s)hidden(\s|$)/, /(^|\s)invisible(\s|$)/, /(^|\s)opacity-0(\s|$)/, /(^|\s)sr-only(\s|$)/, /group-hover:/];

/** Directly visible: no hiding attribute or class on the element or any ancestor, no closed <details>. */
function expectDirectlyVisible(element: HTMLElement, label: string) {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const where = `${label}: <${node.tagName.toLowerCase()} class="${node.className}">`;
    expect(node.hasAttribute("hidden"), where).toBe(false);
    expect(node.getAttribute("aria-hidden"), where).not.toBe("true");
    if (node.tagName === "DETAILS") expect(node.hasAttribute("open"), where).toBe(true);
    const className = typeof node.className === "string" ? node.className : "";
    for (const pattern of HIDING_CLASSES) expect(pattern.test(className), `${where} matches ${pattern}`).toBe(false);
  }
}

let onSelect: ReturnType<typeof vi.fn>;
let onCreate: ReturnType<typeof vi.fn>;

async function renderShell() {
  onSelect = vi.fn();
  onCreate = vi.fn();
  render(
    <DesktopAppShell
      workspaceId="ws-routa"
      workspaceSwitcher={
        <WorkspaceSwitcher
          workspaces={WORKSPACES}
          activeWorkspaceId="ws-routa"
          onSelect={onSelect}
          onCreate={onCreate}
          desktop
        />
      }
    >
      page
    </DesktopAppShell>,
  );
  await waitFor(() => expect(within(sidebarProjects()).queryAllByRole("link")).toHaveLength(6));
}

const switcher = () => screen.getByTestId("desktop-workspace-switcher");
const trigger = () => within(switcher()).getAllByRole("button")[0];
/** Dropdown rows (everything after the trigger). */
const option = (name: string) => within(switcher()).getAllByRole("button", { name }).find((button) => button !== trigger())!;
const openSwitcher = () => fireEvent.click(trigger());
const sidebarProjects = () => screen.getByTestId("shell-sidebar-projects");
const sidebar = () => screen.getByTestId("desktop-shell-sidebar");

interface LegacyItem {
  name: string;
  legacy: string;
  located: string;
  check: () => void;
}

const ITEMS: LegacyItem[] = [
  {
    name: "S1 顶部切换器显示当前工作区名",
    legacy: "workspace-switcher.tsx:134-153",
    located: "testId desktop-workspace-switcher → first button",
    check: () => {
      expect(trigger().textContent).toBe("Routa");
      expect(trigger().getAttribute("aria-haspopup")).toBe("listbox");
      expectDirectlyVisible(trigger(), "S1");
    },
  },
  {
    name: "S2 点开下拉列表",
    legacy: "workspace-switcher.tsx:136-142",
    located: "trigger aria-expanded true after click",
    check: () => {
      openSwitcher();
      expect(trigger().getAttribute("aria-expanded")).toBe("true");
    },
  },
  {
    name: "S3 下拉里按名称搜索过滤",
    legacy: "workspace-switcher.tsx:109-111,159-176",
    located: "role textbox name Search inside switcher",
    check: () => {
      openSwitcher();
      const search = within(switcher()).getByRole("textbox", { name: "Search" });
      expectDirectlyVisible(search, "S3");
      fireEvent.change(search, { target: { value: "TOP" } });
      expect(within(switcher()).getAllByRole("button").map((b) => b.textContent)).toContain("TopBI");
      expect(within(switcher()).queryByRole("button", { name: "turnilo" })).toBeNull();
    },
  },
  {
    name: "S4 顶部下拉列出全部工作区可切换 + 侧栏项目逐行可点",
    legacy: "workspace-switcher.tsx:178-205",
    located: "switcher buttons ×6; testId shell-sidebar-projects links ×6",
    check: () => {
      openSwitcher();
      for (const workspace of WORKSPACES) {
        expect(option(workspace.title)).toBeTruthy();
      }
      fireEvent.click(option("TopBI"));
      expect(onSelect).toHaveBeenCalledWith("ws-topbi");
      const row = within(sidebarProjects()).getByRole("link", { name: "TopBI" });
      expectDirectlyVisible(row, "S4 sidebar");
      expect(row.getAttribute("href")).toBe("/workspace/ws-topbi/kanban");
    },
  },
  {
    name: "S5 当前项带勾 + 侧栏当前项高亮",
    legacy: "workspace-switcher.tsx:200-202",
    located: "switcher active button has svg check; sidebar row aria-current=true",
    check: () => {
      openSwitcher();
      const active = option("Routa");
      expect(active.className).toContain("bg-accent-subtle");
      expect(active.querySelectorAll("svg")).toHaveLength(2);
      const row = within(sidebarProjects()).getByRole("link", { name: "Routa" });
      expect(row.getAttribute("aria-current")).toBe("true");
      expectDirectlyVisible(row, "S5 sidebar");
    },
  },
  {
    name: "S6 没有工作区时显示暂无工作区",
    legacy: "workspace-switcher.tsx:179-183",
    located: "switcher text No workspaces yet when search matches nothing",
    check: () => {
      openSwitcher();
      fireEvent.change(within(switcher()).getByRole("textbox", { name: "Search" }), { target: { value: "zzz" } });
      expectDirectlyVisible(within(switcher()).getByText("No workspaces yet"), "S6");
    },
  },
  {
    name: "S7 新建工作区（输入名称、回车创建）",
    legacy: "workspace-switcher.tsx:207-240",
    located: "button name New Workspace → textbox → Enter",
    check: () => {
      openSwitcher();
      const create = within(switcher()).getByRole("button", { name: /New Workspace/i });
      expectDirectlyVisible(create, "S7");
      fireEvent.click(create);
      const input = within(switcher()).getByPlaceholderText("Workspace name...");
      fireEvent.change(input, { target: { value: "Fresh" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onCreate).toHaveBeenCalledWith("Fresh");
    },
  },
  {
    name: "S8 Esc 关闭下拉",
    legacy: "workspace-switcher.tsx:59-68,74-83",
    located: "trigger aria-expanded false after Escape",
    check: () => {
      openSwitcher();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(trigger().getAttribute("aria-expanded")).toBe("false");
    },
  },
  {
    name: "S9 记住上次工作区（侧栏点击也写同一个键）",
    legacy: "workspace-switcher.tsx:9,85-99",
    located: "localStorage routa.desktop.last-workspace-id",
    check: () => {
      expect(window.localStorage.getItem("routa.desktop.last-workspace-id")).toBe("ws-routa");
      fireEvent.click(within(sidebarProjects()).getByRole("link", { name: "turnilo" }));
      expect(window.localStorage.getItem("routa.desktop.last-workspace-id")).toBe("ws-turnilo");
    },
  },
  {
    name: "R9 宽屏侧栏收起按钮直接可见",
    legacy: "desktop-sidebar.tsx:183-199; desktop-app-shell.tsx:19,83-100",
    located: "testId desktop-shell-sidebar-toggle, name Close sidebar",
    check: () => {
      const toggle = screen.getByRole("button", { name: "Close sidebar" });
      expectDirectlyVisible(toggle, "R9");
      expect(toggle.className).not.toContain("min-[801px]:hidden");
    },
  },
  {
    name: "R10 侧栏特性浏览直接可见",
    legacy: "desktop-sidebar.tsx:106-113",
    located: "role link name Feature explorer in sidebar",
    check: () => {
      const link = within(sidebar()).getByRole("link", { name: "Feature explorer" });
      expectDirectlyVisible(link, "R10");
      expect(link.closest("[data-nav-group]")).toBeNull();
      expect(link.getAttribute("href")).toBe("/workspace/ws-routa/feature-explorer");
    },
  },
  {
    name: "R11 侧栏 Harness 直达带 workspaceId",
    legacy: "desktop-sidebar.tsx:56-58,114-119",
    located: "role link name Harness in sidebar",
    check: () => {
      const link = within(sidebar()).getByRole("link", { name: "Harness" });
      expectDirectlyVisible(link, "R11");
      expect(link.getAttribute("href")).toBe("/settings/harness?workspaceId=ws-routa");
    },
  },
  {
    name: "R12 侧栏 Fluency 直达带 workspaceId",
    legacy: "desktop-sidebar.tsx:59-61,120-125",
    located: "role link name Fluency in sidebar",
    check: () => {
      const link = within(sidebar()).getByRole("link", { name: "Fluency" });
      expectDirectlyVisible(link, "R12");
      expect(link.getAttribute("href")).toBe("/settings/fluency?workspaceId=ws-routa");
    },
  },
  {
    name: "R13 侧栏设置链接带 workspaceId",
    legacy: "desktop-sidebar.tsx:129-131",
    located: "role link name Settings in sidebar",
    check: () => {
      const link = within(sidebar()).getByRole("link", { name: "Settings" });
      expectDirectlyVisible(link, "R13");
      expect(link.getAttribute("href")).toBe("/settings?workspaceId=ws-routa");
    },
  },
];

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

beforeEach(() => {
  window.localStorage.clear();
  resetSidebarNavGroupCache();
  resetSidebarWorkspacesCache();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      new Response(JSON.stringify(String(input).includes("/api/workspaces") ? { workspaces: WORKSPACES } : {}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Legacy features stay directly visible (S1–S9, R9–R13)", () => {
  it("lists all 14 items", () => {
    expect(ITEMS.map((item) => item.name.split(" ")[0])).toEqual([
      "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "R9", "R10", "R11", "R12", "R13",
    ]);
  });

  it.each(ITEMS)("$name ($legacy → $located)", async (item) => {
    await renderShell();
    expectDirectlyVisible(sidebarProjects(), `${item.name} / projects group`);
    item.check();
  });
});
