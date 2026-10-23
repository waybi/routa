import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pathnameState = vi.hoisted(() => ({ pathname: "/workspace/w-0/kanban" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameState.pathname,
}));

import { DesktopSidebar } from "../desktop-sidebar";
import { resetSidebarNavGroupCache } from "../shell/sidebar-nav-groups";
import { loadSidebarWorkspaces, resetSidebarWorkspacesCache } from "../shell/use-sidebar-workspaces";
import type { TranslationDictionary } from "@/i18n";
import { I18nContext } from "@/i18n/context";
import en from "@/i18n/locales/en";
import zh from "@/i18n/locales/zh";

/** Written as literals on purpose: reverting the implementation must fail on assertions, not on imports. */
const PROJECTS_KEY = "routa.shell.nav.projects";
const RESOURCES_KEY = "routa.shell.nav.resources";
const DEVELOPER_KEY = "routa.shell.nav.developer";

type Entry = "wide" | "drawer" | "drawerCollapsed" | "rail";
const ENTRY_PROPS: Record<Entry, { collapsed?: boolean; drawerOpen?: boolean }> = {
  wide: {},
  drawer: { drawerOpen: true },
  drawerCollapsed: { drawerOpen: true, collapsed: true },
  rail: { collapsed: true },
};

function makeWorkspaces(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `w-${i}`,
    title: `Project ${i}`,
    createdAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
  }));
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

let workspaceCount = 6;

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/workspaces?status=active")) return jsonResponse({ workspaces: makeWorkspaces(workspaceCount) });
      if (url.includes("/codebases")) return jsonResponse({ codebases: [{ id: "cb-1" }] });
      if (url.includes("/canvas")) return jsonResponse({ canvasArtifacts: [] });
      return jsonResponse({});
    }),
  );
}

function sidebar(entry: Entry, dict?: TranslationDictionary) {
  const element = <DesktopSidebar workspaceId="w-0" onDrawerClose={() => {}} {...ENTRY_PROPS[entry]} />;
  if (!dict) return element;
  return <I18nContext value={{ locale: dict === zh ? "zh" : "en", setLocale: () => {}, t: dict }}>{element}</I18nContext>;
}

const projects = () => screen.getByTestId("shell-sidebar-projects");
const projectButtons = () => within(projects()).queryAllByRole("button");
const projectButton = () => within(projects()).getByRole("button");
const projectRows = () => within(projects()).queryAllByRole("link");
const projectList = () => screen.queryByTestId("shell-sidebar-projects-list");
const group = (id: "resources" | "developer") => document.querySelector<HTMLElement>(`[data-nav-group="${id}"]`);
const nav = () => screen.getByRole("navigation");

/** Lets the shared workspace read resolve and the sidebar re-render with it. */
async function settle() {
  await act(async () => {
    await loadSidebarWorkspaces("w-0");
  });
}

function follows(a: Node, b: Node) {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

beforeEach(() => {
  window.localStorage.clear();
  resetSidebarNavGroupCache();
  resetSidebarWorkspacesCache();
  pathnameState.pathname = "/workspace/w-0/kanban";
  workspaceCount = 6;
  installFetch();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("C1 · order: top entries → Projects → Resources → Developer (AC1, AC6)", () => {
  it.each<Entry>(["wide", "drawer"])("%s", async (entry) => {
    render(sidebar(entry));
    await waitFor(() => expect(projectRows()).toHaveLength(6));

    const links = within(nav()).getAllByRole("link");
    expect(links).toHaveLength(10);
    const settings = links[links.length - 1];
    expect(settings.textContent).toBe("Settings");
    const resources = group("resources")!;
    const developer = group("developer")!;
    expect(follows(settings, projects())).toBe(true);
    expect(follows(projects(), resources)).toBe(true);
    expect(follows(resources, developer)).toBe(true);
    expect(nav().contains(projects())).toBe(false);
    expect(nav().contains(resources)).toBe(false);
    expect(nav().contains(developer)).toBe(false);
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
  });
});

describe("C2 · Projects heading is a fold button styled like the groups (AC2, AC6)", () => {
  it.each<[Entry, string, TranslationDictionary]>([
    ["wide", "en", en],
    ["drawer", "en", en],
    ["wide", "zh", zh],
    ["drawer", "zh", zh],
  ])("%s · %s", async (entry, _locale, dict) => {
    render(sidebar(entry, dict));
    await waitFor(() => expect(projectRows()).toHaveLength(6));

    expect(projectButtons()).toHaveLength(1);
    const button = projectButton();
    expect(within(projects()).getByRole("button", { name: dict.shell.projects.title })).toBe(button);
    expect(button.closest("h2")).not.toBeNull();
    expect(button.querySelector("svg")).not.toBeNull();
    for (const name of ["text-[11px]", "font-semibold", "hover:bg-hover"]) expect(button.className).toContain(name);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const listId = projectList()!.id;
    expect(listId).not.toBe("");
    expect(button.getAttribute("aria-controls")).toBe(listId);

    fireEvent.click(button);
    expect(projectList()).toBeNull();
    expect(projectButton().getAttribute("aria-expanded")).toBe("false");
    expect(projectButton().hasAttribute("aria-controls")).toBe(false);

    fireEvent.click(projectButton());
    expect(projectList()).not.toBeNull();
    expect(projectRows()).toHaveLength(6);
    expect(projectButton().getAttribute("aria-expanded")).toBe("true");
  });
});

describe("C3 · fold state is stored under routa.shell.nav.projects (AC3)", () => {
  it("writes \"false\" / \"true\" and survives a remount", async () => {
    const { unmount } = render(sidebar("wide"));
    await settle();
    fireEvent.click(projectButton());
    expect(window.localStorage.getItem(PROJECTS_KEY)).toBe("false");
    fireEvent.click(projectButton());
    expect(window.localStorage.getItem(PROJECTS_KEY)).toBe("true");
    fireEvent.click(projectButton());
    unmount();

    render(sidebar("wide"));
    await settle();
    expect(projectList()).toBeNull();
    expect(projectButton().getAttribute("aria-expanded")).toBe("false");
  });

  it("starts collapsed when the stored value is \"false\"", async () => {
    window.localStorage.setItem(PROJECTS_KEY, "false");
    render(sidebar("wide"));
    await settle();
    expect(projectList()).toBeNull();
    expect(projectButton().getAttribute("aria-expanded")).toBe("false");
  });

  it("does not touch the Resources / Developer keys, and they do not touch it", async () => {
    window.localStorage.setItem(RESOURCES_KEY, "false");
    window.localStorage.setItem(DEVELOPER_KEY, "true");
    render(sidebar("wide"));
    await settle();
    fireEvent.click(projectButton());
    fireEvent.click(projectButton());
    expect(window.localStorage.getItem(RESOURCES_KEY)).toBe("false");
    expect(window.localStorage.getItem(DEVELOPER_KEY)).toBe("true");

    window.localStorage.setItem(PROJECTS_KEY, "false");
    window.dispatchEvent(new StorageEvent("storage", { key: PROJECTS_KEY }));
    await act(async () => {
      fireEvent.click(within(group("resources")!).getByRole("button"));
    });
    fireEvent.click(within(group("developer")!).getByRole("button"));
    expect(window.localStorage.getItem(PROJECTS_KEY)).toBe("false");
    expect(window.localStorage.getItem(RESOURCES_KEY)).toBe("true");
    expect(window.localStorage.getItem(DEVELOPER_KEY)).toBe("false");
  });
});

/** Makes getItem throw for the three sidebar group keys only. */
function throwOnGroupKeys() {
  const original = Storage.prototype.getItem;
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(function getItem(this: Storage, key: string) {
    if (key.startsWith("routa.shell.nav.")) throw new Error("storage denied");
    return original.call(this, key);
  });
}

describe("C4 · unknown stored values default to expanded, including SSR (AC4)", () => {
  it.each([
    ["missing", null],
    ["\"true\"", "true"],
    ["garbage", "garbage"],
    ["getItem throws", "throw"],
  ])("%s → expanded", async (_label, value) => {
    if (value === "throw") throwOnGroupKeys();
    else if (value !== null) window.localStorage.setItem(PROJECTS_KEY, value);
    render(sidebar("wide"));
    await waitFor(() => expect(projectRows()).toHaveLength(6));
    expect(projectList()).not.toBeNull();
    expect(projectButton().getAttribute("aria-expanded")).toBe("true");
  });

  it("server render shows the list and an expanded fold button", () => {
    window.localStorage.setItem(PROJECTS_KEY, "false");
    const html = renderToString(<DesktopSidebar workspaceId="ws-1" />);
    expect(html).toContain('data-testid="shell-sidebar-projects-list"');
    const section = html.slice(html.indexOf('data-testid="shell-sidebar-projects"'));
    expect(section).toMatch(/<button[^>]*aria-expanded="true"/);
  });

  it("C9 · hydrates a stored \"false\" without mismatch errors, then collapses", async () => {
    const html = renderToString(<DesktopSidebar workspaceId="w-0" />);
    window.localStorage.setItem(PROJECTS_KEY, "false");
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(container, <DesktopSidebar workspaceId="w-0" />);
      });
      await settle();
      expect(errors.mock.calls.filter((args) => String(args[0]).toLowerCase().includes("hydrat"))).toEqual([]);
      expect(container.querySelector('[data-testid="shell-sidebar-projects-list"]')).toBeNull();
      expect(container.querySelector('[data-testid="shell-sidebar-projects"] button')?.getAttribute("aria-expanded")).toBe("false");
    } finally {
      act(() => root?.unmount());
      container.remove();
    }
  });
});

describe("C5 · icon rail always shows the initial squares (AC5)", () => {
  it("no fold button, one square per workspace, no groups", async () => {
    render(sidebar("rail"));
    await waitFor(() => expect(projectRows()).toHaveLength(6));
    expect(projectButtons()).toHaveLength(0);
    expect(document.querySelectorAll("[data-nav-group]")).toHaveLength(0);
  });

  it("still shows the squares after Projects was collapsed on the wide sidebar", async () => {
    const { rerender } = render(sidebar("wide"));
    await waitFor(() => expect(projectRows()).toHaveLength(6));
    fireEvent.click(projectButton());
    expect(window.localStorage.getItem(PROJECTS_KEY)).toBe("false");
    expect(projectRows()).toHaveLength(0);

    rerender(sidebar("rail"));
    expect(projectButtons()).toHaveLength(0);
    expect(projectRows()).toHaveLength(6);
    expect(projectRows().map((link) => link.textContent)).toEqual(["P", "P", "P", "P", "P", "P"]);
    expect(document.querySelectorAll("[data-nav-group]")).toHaveLength(0);
  });
});

describe("C6 · layout classes: no flex-1 stretch, list scrolls on its own (AC8)", () => {
  it("12 workspaces", async () => {
    workspaceCount = 12;
    render(sidebar("wide"));
    await waitFor(() => expect(projectRows()).toHaveLength(12));
    expect(projects().className).not.toContain("flex-1");
    const list = projectList()!;
    expect(list.className).toContain("overflow-y-auto");
    expect(list.className).toContain("min-h-0");
    expect(list.className).not.toContain("flex-1");
  });
});

describe("spot checks (C10, C11, C12, C16)", () => {
  it("C10 · another tab's change reaches Projects and Resources alike", async () => {
    render(sidebar("wide"));
    await settle();
    window.localStorage.setItem(PROJECTS_KEY, "false");
    window.localStorage.setItem(RESOURCES_KEY, "true");
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: PROJECTS_KEY }));
    });
    expect(projectButton().getAttribute("aria-expanded")).toBe("false");
    expect(within(group("resources")!).getByRole("button").getAttribute("aria-expanded")).toBe("true");
  });

  it("C11 · two sidebars fold together", async () => {
    render(
      <>
        {sidebar("wide")}
        {sidebar("wide")}
      </>,
    );
    await settle();
    const sections = () => screen.getAllByTestId("shell-sidebar-projects");
    fireEvent.click(within(sections()[0]).getByRole("button"));
    expect(screen.queryAllByTestId("shell-sidebar-projects-list")).toHaveLength(0);
    expect(within(sections()[1]).getByRole("button").getAttribute("aria-expanded")).toBe("false");
  });

  it("C12 · zero workspaces: empty row when expanded, nothing when collapsed, dash in the rail", async () => {
    workspaceCount = 0;
    const { rerender } = render(sidebar("wide"));
    await settle();
    expect(within(projects()).getByText("No workspaces yet")).toBeTruthy();
    fireEvent.click(projectButton());
    expect(within(projects()).queryByText("No workspaces yet")).toBeNull();
    expect(projectList()).toBeNull();
    rerender(sidebar("rail"));
    expect(within(projectList()!).getByText("–")).toBeTruthy();
  });

  it("C16 · keyboard: the fold button is a native button", async () => {
    render(sidebar("wide"));
    await settle();
    const button = projectButton();
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    button.focus();
    expect(document.activeElement).toBe(button);
  });
});

/** F3 judge: written from the requirement, never from the implementation. */
function expected(entry: Entry, project: string | null, resources: string | null, developer: string | null, throws: boolean, count: number) {
  if (entry === "rail") return { buttons: 0, rows: count, groups: 0, expanded: null, resources: null, developer: null };
  const projectOpen = throws ? true : project !== "false";
  return {
    buttons: 1,
    rows: projectOpen ? count : 0,
    groups: 2,
    expanded: projectOpen ? "true" : "false",
    resources: throws ? "false" : resources === "true" ? "true" : "false",
    developer: throws ? "false" : developer === "true" ? "true" : "false",
  };
}

describe("F3 · exhaustive cross-check of stored keys × entry × workspace count (444 cases)", () => {
  it("matches the requirement judge for every combination", async () => {
    pathnameState.pathname = "/workspace/w-0";
    const projectValues = [null, "true", "false", "garbage"];
    const groupValues = [null, "true", "false"];
    const entries: Entry[] = ["wide", "drawer", "drawerCollapsed", "rail"];
    const cases: Array<[Entry, string | null, string | null, string | null, boolean, number]> = [];
    for (const count of [1, 6, 12]) {
      for (const entry of entries) {
        for (const p of projectValues) for (const r of groupValues) for (const d of groupValues) cases.push([entry, p, r, d, false, count]);
        cases.push([entry, null, null, null, true, count]);
      }
    }
    expect(cases).toHaveLength(444);

    const mismatches: string[] = [];
    let lastCount = -1;
    for (const [entry, p, r, d, throws, count] of cases) {
      if (count !== lastCount) {
        resetSidebarWorkspacesCache();
        workspaceCount = count;
        lastCount = count;
      }
      window.localStorage.clear();
      if (p !== null) window.localStorage.setItem(PROJECTS_KEY, p);
      if (r !== null) window.localStorage.setItem(RESOURCES_KEY, r);
      if (d !== null) window.localStorage.setItem(DEVELOPER_KEY, d);
      if (throws) throwOnGroupKeys();
      render(sidebar(entry));
      await settle();

      const want = expected(entry, p, r, d, throws, count);
      const resourcesButton = group("resources") && within(group("resources")!).getByRole("button");
      const developerButton = group("developer") && within(group("developer")!).getByRole("button");
      const links = within(nav()).getAllByRole("link");
      let ordered = follows(links[links.length - 1], projects());
      if (want.groups) ordered = ordered && follows(projects(), group("resources")!) && follows(group("resources")!, group("developer")!);
      const got = {
        buttons: projectButtons().length,
        rows: projectRows().length,
        groups: document.querySelectorAll("[data-nav-group]").length,
        expanded: projectButtons()[0]?.getAttribute("aria-expanded") ?? null,
        resources: resourcesButton?.getAttribute("aria-expanded") ?? null,
        developer: developerButton?.getAttribute("aria-expanded") ?? null,
      };
      if (!ordered || JSON.stringify(got) !== JSON.stringify(want)) {
        mismatches.push(`${entry}|p=${p}|r=${r}|d=${d}|throw=${throws}|n=${count} want=${JSON.stringify(want)} got=${JSON.stringify(got)} ordered=${ordered}`);
      }
      cleanup();
      if (throws) vi.restoreAllMocks();
    }
    console.info(`F3 mismatches: ${mismatches.length} / ${cases.length}`);
    expect(mismatches.length, mismatches.slice(0, 5).join("\n")).toBe(0);
  }, 240_000);
});
