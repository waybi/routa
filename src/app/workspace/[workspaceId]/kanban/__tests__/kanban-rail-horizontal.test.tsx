/**
 * Narrow columns write their text horizontally (card 92744a50). The empty
 * column rail and the collapsed Done rail stay narrow drop targets, but the
 * column name, the counts and the unmerged badge are no longer rotated, never
 * truncated, and stay visible as text (not only in title / aria-label). The
 * loading skeleton uses the same narrow width so the board does not jump.
 */
import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nContext } from "@/i18n/context";
import en from "@/i18n/locales/en";
import zh from "@/i18n/locales/zh";
import type { KanbanBoardInfo, TaskInfo } from "../../types";
import { KanbanTab } from "../kanban-tab";
import { KanbanBoardSkeleton } from "../kanban-tab-content";
import {
  EMPTY_COLUMN_RAIL_WIDTH,
  EMPTY_COLUMN_RAIL_WIDTH_CLASS,
  KanbanDoneCollapsedRail,
  KanbanEmptyColumnRail,
} from "../kanban-empty-column-rail";
import { resetDesktopAwareFetchToGlobalFetch } from "./test-utils";

const { desktopAwareFetch } = vi.hoisted(() => ({ desktopAwareFetch: vi.fn() }));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  DragOverlay: ({ children }: { children: ReactNode }) => <>{children}</>,
  MouseSensor: class {},
  TouchSensor: class {},
  closestCorners: vi.fn(),
  useDroppable: () => ({ isOver: false, setNodeRef: vi.fn() }),
  useDraggable: () => ({ attributes: {}, isDragging: false, listeners: {}, setNodeRef: vi.fn(), transform: null }),
  useSensor: vi.fn(),
  useSensors: vi.fn(() => []),
}));

vi.mock("@/client/utils/diagnostics", async () => {
  const actual = await vi.importActual<typeof import("@/client/utils/diagnostics")>("@/client/utils/diagnostics");
  return { ...actual, desktopAwareFetch };
});

vi.mock("@/client/components/repo-picker", () => ({
  RepoPicker: () => <div data-testid="repo-picker-mock" />,
  shortenRepoPath: (value: string) => value,
}));

vi.mock("../use-runtime-fitness-status", async () => {
  const { mockUseRuntimeFitnessStatus } = await import("./test-utils");
  return { useRuntimeFitnessStatus: mockUseRuntimeFitnessStatus };
});

type Lang = "en" | "zh";
const dictionaries = { en, zh } as const;

/** Classes that rotate text or hide part of it. */
const FORBIDDEN = /vertical-rl|vertical-lr|writing-mode|rotate-|truncate|text-ellipsis|line-clamp/;

function withLang(lang: Lang, node: ReactNode) {
  return (
    <I18nContext.Provider value={{ locale: lang, setLocale: () => {}, t: dictionaries[lang] }}>
      {node}
    </I18nContext.Provider>
  );
}

function subtreeClasses(root: Element): string[] {
  return [root, ...Array.from(root.querySelectorAll("*"))].map((element) => element.getAttribute("class") ?? "");
}

function expectNoForbiddenClass(root: Element) {
  for (const className of subtreeClasses(root)) {
    expect(className).not.toMatch(FORBIDDEN);
  }
}

/** Pixel width of a Tailwind width class: w-[Nrem], w-[Npx] or w-N (N × 4px). */
function widthClassToPx(widthClass: string): number {
  const rem = widthClass.match(/^w-\[(\d+(?:\.\d+)?)rem\]$/);
  if (rem) return Number(rem[1]) * 16;
  const px = widthClass.match(/^w-\[(\d+(?:\.\d+)?)px\]$/);
  if (px) return Number(px[1]);
  const scale = widthClass.match(/^w-(\d+(?:\.\d+)?)$/);
  if (scale) return Number(scale[1]) * 4;
  return Number.NaN;
}

const COLUMN_NAMES = ["Backlog", "Todo", "Dev", "Review", "Blocked"] as const;

beforeEach(() => {
  resetDesktopAwareFetchToGlobalFetch(desktopAwareFetch);
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("narrow column width constant", () => {
  it("is one width class between 84px and 96px, and not the old 40px rail", () => {
    expect(EMPTY_COLUMN_RAIL_WIDTH.split(/\s+/)).toHaveLength(1);
    expect(EMPTY_COLUMN_RAIL_WIDTH).not.toBe("w-10");
    const px = widthClassToPx(EMPTY_COLUMN_RAIL_WIDTH);
    expect(px).toBeGreaterThanOrEqual(84);
    expect(px).toBeLessThanOrEqual(96);
    expect(EMPTY_COLUMN_RAIL_WIDTH_CLASS.split(/\s+/)).toContain(EMPTY_COLUMN_RAIL_WIDTH);
  });
});

describe("empty column rail is horizontal", () => {
  const cases = (["en", "zh"] as const).flatMap((lang) => COLUMN_NAMES.map((name) => [lang, name] as const));

  it.each(cases)("%s: %s shows the full name and 0 as visible horizontal text", (lang, name) => {
    const columnId = name.toLowerCase();
    render(withLang(lang, <KanbanEmptyColumnRail columnId={columnId} name={name} />));

    const rail = screen.getByTestId("kanban-empty-column-rail");
    expectNoForbiddenClass(rail);
    expect(rail.getAttribute("data-column-id")).toBe(columnId);
    expect(rail.textContent).toContain(name);
    expect(rail.textContent).not.toContain("…");
    expect(within(rail).getByTestId("kanban-rail-column-name").textContent).toBe(name);
    const count = within(rail).getByTestId(`kanban-column-count-${columnId}`);
    expect(count.textContent).toBe("0");
    expect(count.className).toContain("tabular-nums");
    // Hint copy is unchanged from main (493dae43).
    const hint = lang === "en" ? `${name} has no cards; drop a card here` : `${name} 暂无卡片，可把卡片拖到这里`;
    expect(rail.getAttribute("title")).toBe(hint);
  });
});

describe("collapsed Done rail is horizontal", () => {
  const expected = {
    en: { label: "Done column is collapsed", expand: "Expand Done", unmerged: (n: number) => `${n} unmerged` },
    zh: { label: "Done 列已折叠", expand: "展开 Done", unmerged: (n: number) => `${n} 张未合入` },
  } as const;

  it.each(["en", "zh"] as const)("%s: unmerged 12 shows a full, unrotated badge and the expand button", (lang) => {
    const onExpand = vi.fn();
    render(withLang(lang, (
      <KanbanDoneCollapsedRail columnId="done" name="Done" total={128} unmergedCount={12} onExpand={onExpand} />
    )));

    const rail = screen.getByTestId("kanban-done-collapsed-rail");
    expectNoForbiddenClass(rail);
    expect(rail.getAttribute("aria-label")).toBe(expected[lang].label);

    const badge = within(rail).getByTestId("kanban-done-unmerged-count");
    expect(badge.textContent).toBe(expected[lang].unmerged(12));
    for (let node: HTMLElement | null = badge; node && node !== rail.parentElement; node = node.parentElement) {
      expect(node.className).not.toMatch(/whitespace-nowrap/);
    }

    const total = within(rail).getByTestId("kanban-column-count-done");
    expect(total.textContent).toBe("128");
    expect(total.className).toContain("tabular-nums");

    const toggle = within(rail).getByTestId("kanban-done-collapse-toggle");
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-label")).toBe(expected[lang].expand);
    // The column name is visible text on the button, not only its label.
    expect(toggle.textContent).toBe("Done");
    expect(within(toggle).getByTestId("kanban-rail-column-name").textContent).toBe("Done");

    fireEvent.click(toggle);
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it.each(["en", "zh"] as const)("%s: unmerged 0 hides the badge", (lang) => {
    render(withLang(lang, (
      <KanbanDoneCollapsedRail columnId="done" name="Done" total={3} unmergedCount={0} onExpand={vi.fn()} />
    )));
    const rail = screen.getByTestId("kanban-done-collapsed-rail");
    expect(within(rail).queryByTestId("kanban-done-unmerged-count")).toBeNull();
    expectNoForbiddenClass(rail);
  });
});

describe("loading skeleton", () => {
  it("uses the narrow width for its two rail columns", () => {
    render(<KanbanBoardSkeleton label="Loading" />);
    const columns = screen.getAllByTestId("kanban-board-skeleton-column");
    expect(columns).toHaveLength(5);
    for (const rail of columns.slice(0, 2)) {
      expect(rail.className.split(/\s+/)).toContain(EMPTY_COLUMN_RAIL_WIDTH);
      expect(rail.className.split(/\s+/)).not.toContain("w-10");
    }
    for (const lane of columns.slice(2)) {
      expect(lane.className).not.toContain(EMPTY_COLUMN_RAIL_WIDTH);
    }
  });
});

function makeBoard(): KanbanBoardInfo {
  return {
    id: "board-1",
    workspaceId: "workspace-1",
    name: "Board",
    isDefault: true,
    sessionConcurrencyLimit: 1,
    queue: { runningCount: 0, runningCards: [], queuedCount: 0, queuedCardIds: [], queuedCards: [], queuedPositions: {} },
    columns: [
      { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
      { id: "todo", name: "Todo", position: 1, stage: "todo" },
      { id: "dev", name: "Dev", position: 2, stage: "dev" },
      { id: "review", name: "Review", position: 3, stage: "review" },
      { id: "done", name: "Done", position: 4, stage: "done" },
      { id: "blocked", name: "Blocked", position: 5, stage: "blocked" },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeTask(id: string, columnId: string, index: number, landed: boolean): TaskInfo {
  return {
    id,
    title: `${columnId} card ${index}`,
    objective: "objective",
    status: columnId === "done" ? "COMPLETED" : "PENDING",
    boardId: "board-1",
    columnId,
    position: index,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    deliveryLanding: columnId === "done" ? { landedOnBase: landed, commitsSinceBase: landed ? 0 : 1 } : undefined,
  } as TaskInfo;
}

describe("through the board surface (every path)", () => {
  it.each(["en", "zh"] as const)("%s: empty rails and the collapsed Done rail are narrow and horizontal", (lang) => {
    window.localStorage.setItem("routa.kanban.doneCollapsed.board-1", "1");
    const tasks = [
      makeTask("dev-0", "dev", 0, false),
      ...Array.from({ length: 25 }, (_, index) => makeTask(`done-${index}`, "done", index, index < 13)),
    ];
    render(withLang(lang, (
      <KanbanTab
        workspaceId="workspace-1"
        boards={[makeBoard()]}
        tasks={tasks}
        sessions={[]}
        providers={[]}
        specialists={[]}
        codebases={[]}
        onRefresh={vi.fn()}
      />
    )));

    const columns = new Map(screen.getAllByTestId("kanban-column").map((element) => [element.getAttribute("data-column-id"), element]));

    for (const id of ["backlog", "todo", "review", "blocked"]) {
      const column = columns.get(id)!;
      expect(column.className.split(/\s+/)).toContain(EMPTY_COLUMN_RAIL_WIDTH);
      expect(column.className.split(/\s+/)).not.toContain("w-10");
      const rail = within(column).getByTestId("kanban-empty-column-rail");
      expectNoForbiddenClass(rail);
      expect(within(rail).getByTestId("kanban-rail-column-name").textContent).toBe(makeBoard().columns.find((c) => c.id === id)!.name);
    }

    const done = columns.get("done")!;
    expect(done.className.split(/\s+/)).toContain(EMPTY_COLUMN_RAIL_WIDTH);
    expect(done.className.split(/\s+/)).not.toContain("w-10");
    const doneRail = within(done).getByTestId("kanban-done-collapsed-rail");
    expectNoForbiddenClass(doneRail);
    expect(within(doneRail).getByTestId("kanban-column-count-done").textContent).toBe("25");
    expect(within(doneRail).getByTestId("kanban-done-unmerged-count").textContent).toBe(
      lang === "en" ? "12 unmerged" : "12 张未合入",
    );

    // A column with cards keeps its normal width.
    const dev = columns.get("dev")!;
    expect(dev.className).not.toContain(EMPTY_COLUMN_RAIL_WIDTH);
    expect(dev.className).toContain("w-[18rem]");
    expect(within(dev).queryByTestId("kanban-empty-column-rail")).toBeNull();
  });
});

/** Seeded PRNG (mulberry32) so the cross-check is reproducible. */
function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const NAME_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz待办开发评审完成阻塞列名";

const CROSS_CHECK_SEED = 20261023;
const CROSS_CHECK_GROUPS = 10_000;

describe("random cross-check (judged from the requirement, not from the old output)", () => {
  it(`seed ${CROSS_CHECK_SEED}: ${CROSS_CHECK_GROUPS} groups have full horizontal text`, () => {
    const random = mulberry32(CROSS_CHECK_SEED);
    const pick = (max: number) => Math.floor(random() * max);
    const realNames = ["Backlog", "Todo", "Dev", "Review", "Done", "Blocked"];
    const failures: string[] = [];

    for (let group = 0; group < CROSS_CHECK_GROUPS; group += 1) {
      const lang: Lang = random() < 0.5 ? "en" : "zh";
      const name = random() < 0.5
        ? realNames[pick(realNames.length)]
        : Array.from({ length: 1 + pick(12) }, () => NAME_CHARS[pick(NAME_CHARS.length)]).join("");
      const kind = random() < 0.5 ? "empty" : "done";
      const total = pick(10_000);
      const unmerged = pick(10_000);
      const columnId = `col-${group}`;

      const markup = renderToStaticMarkup(withLang(lang, kind === "empty"
        ? <KanbanEmptyColumnRail columnId={columnId} name={name} />
        : <KanbanDoneCollapsedRail columnId={columnId} name={name} total={total} unmergedCount={unmerged} onExpand={() => {}} />));
      const host = document.createElement("div");
      host.innerHTML = markup;
      const root = host.firstElementChild!;
      const problems: string[] = [];

      // Expected values computed from the requirement and the i18n template.
      const expectedCount = kind === "empty" ? "0" : String(total);
      const count = root.querySelector(`[data-testid="kanban-column-count-${columnId}"]`);
      if (count?.textContent !== expectedCount) problems.push("count");
      if (!count?.getAttribute("class")?.includes("tabular-nums")) problems.push("tabular-nums");
      if (root.querySelector('[data-testid="kanban-rail-column-name"]')?.textContent !== name) problems.push("name");
      if (subtreeClasses(root).some((className) => FORBIDDEN.test(className))) problems.push("forbidden class");
      if (kind === "done") {
        const badge = root.querySelector('[data-testid="kanban-done-unmerged-count"]');
        const expectedBadge = unmerged > 0 ? dictionaries[lang].pagesRedesign.doneRail.unmerged.replace("{count}", String(unmerged)) : null;
        if ((badge?.textContent ?? null) !== expectedBadge) problems.push("badge");
      }
      if (problems.length > 0) failures.push(`${group}:${kind}:${lang}:${name}:${total}:${unmerged}:${problems.join("+")}`);
    }

    expect(failures.length, failures.slice(0, 5).join("\n")).toBe(0);
  });
});
