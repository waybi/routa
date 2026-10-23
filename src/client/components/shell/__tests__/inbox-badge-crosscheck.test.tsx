/**
 * Card c908dc70, contract F3: 10,000 random inputs. The judge is written from
 * the requirement (scope rule, readiness gate, 0 hides, >99 → 99+); the row
 * count itself is the Needs-you page's own buildInboxRows(...).active.length.
 * 200 samples also go through the real hook + component to confirm they
 * match the pure function.
 */
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { KanbanBoardInfo, TaskInfo } from "@/app/workspace/[workspaceId]/types";
import { buildInboxRows } from "@/app/workspace/[workspaceId]/overview/inbox-rules";
import type { OverviewWorkspaceData } from "@/app/workspace/[workspaceId]/kanban/use-kanban-overview-data";
import { resetAttentionDismissalsForTests } from "@/app/workspace/[workspaceId]/kanban/use-kanban-attention-dismissals";
import { I18nProvider } from "@/i18n";
import {
  badgeWorkspaceId,
  computeInboxBadgeCount,
  formatInboxBadgeCount,
  resolveBadgeScope,
  type InboxBadgeSource,
} from "../inbox-badge-rules";

const nav = vi.hoisted(() => ({ pathname: "/" }));
const clock = vi.hoisted(() => ({ now: 0 }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
vi.mock("@/client/components/home/relative-time", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/client/components/home/relative-time")>();
  return { ...actual, useMinuteClock: () => clock.now };
});

import { InboxBadgeDataProvider } from "../inbox-badge-data-context";
import { InboxNavBadge } from "../inbox-nav-badge";

const SEED = 0xc908dc70;
const BASE = Date.UTC(2026, 9, 21, 12);
const DAY = 86_400_000;

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Sample {
  source: InboxBadgeSource;
  dismissed: Record<string, string[]>;
  pathname: string;
  search: string;
  workspaceId: string | null;
  now: number;
}

function makeSample(random: () => number): Sample {
  const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)];
  const wsCount = 1 + Math.floor(random() * 5);
  const ids = ["default", "w1", "w2", "w3", "w4"].slice(0, wsCount);
  const now = random() < 0.08 ? 0 : BASE + Math.floor(random() * 3) * 60_000;
  const data: Record<string, OverviewWorkspaceData | undefined> = {};
  const dismissed: Record<string, string[]> = {};
  for (const ws of ids) {
    const state = random();
    if (state < 0.05) continue; // missing data
    const status: OverviewWorkspaceData["status"] = state < 0.12 ? "loading" : state < 0.2 ? "error" : "ready";
    const boardId = `${ws}-b`;
    const withPusher = random() < 0.5;
    const board = {
      id: boardId,
      name: boardId,
      isDefault: true,
      columns: [
        { id: "dev", name: "Dev", position: 0, stage: "dev" },
        { id: "done", name: "Done", position: 1, stage: "done", automation: { enabled: true, steps: withPusher ? [{ id: "p", specialistId: "kanban-main-pusher" }] : [] } },
        { id: "blocked", name: "Blocked", position: 2, stage: "blocked" },
      ],
    } as unknown as KanbanBoardInfo;
    const taskCount = Math.floor(random() * 41);
    const tasks: TaskInfo[] = [];
    for (let i = 0; i < taskCount; i += 1) {
      const columnId = pick(["dev", "done", "blocked"] as const);
      const age = Math.floor(random() * 10 * DAY);
      const status = pick(["completed", "failed", "timed_out", "running", "transitioned"] as const);
      tasks.push({
        id: `${ws}-t${i}`,
        title: `t${i}`,
        status: columnId === "done" ? "COMPLETED" : "PENDING",
        boardId,
        columnId,
        createdAt: new Date(BASE - age - DAY).toISOString(),
        updatedAt: new Date(BASE - age).toISOString(),
        completionSummary: random() < 0.3 ? "done" : undefined,
        deliveryLanding: random() < 0.3 ? { landedOnBase: false, commitsSinceBase: 1 + Math.floor(random() * 3) } : undefined,
        laneSessions: columnId === "done"
          ? [{ sessionId: `s${i}`, columnId: "done", startedAt: new Date(BASE - age).toISOString(), completedAt: new Date(BASE - age + 60_000).toISOString(), status }]
          : [],
      } as unknown as TaskInfo);
    }
    data[ws] = { status, tasks, boards: [board] };
    const keys: string[] = [];
    for (const task of tasks) {
      if (random() < 0.15) keys.push(`${task.id}|${pick(["blocked", "doneFailed", "noReport"])}|0`);
    }
    dismissed[boardId] = keys;
  }
  const routeWs = random() < 0.15 ? null : pick(ids);
  const page = pick(["overview", "kanban", "settings"] as const);
  const pathname = page === "settings" || routeWs === null ? "/settings" : `/workspace/${routeWs}/${page}`;
  const search = random() < 0.5 ? "?view=all" : "";
  return {
    source: { workspaces: ids.map((id) => ({ id, title: id })), workspacesLoading: random() < 0.05, data },
    dismissed,
    pathname,
    search,
    workspaceId: pathname === "/settings" ? null : routeWs,
    now,
  };
}

interface Plant {
  anyPathReadsViewAll?: boolean;
  printHundred?: boolean;
}

/** Judge written from the requirement, independent of inbox-badge-rules. */
function judge(sample: Sample, plant: Plant = {}): string | null {
  const viewAll = sample.search.includes("view=all");
  const onInboxPage = sample.pathname.endsWith("/overview");
  const all = (plant.anyPathReadsViewAll || onInboxPage) && viewAll;
  const current = sample.workspaceId && sample.workspaceId.trim() ? sample.workspaceId : "default";
  const scoped = all ? sample.source.workspaces : sample.source.workspaces.filter((ws) => ws.id === current);
  if (sample.now === 0 || sample.source.workspacesLoading) return null;
  for (const ws of scoped) {
    const entry = sample.source.data[ws.id];
    if (!entry || entry.status === "loading") return null;
  }
  const count = buildInboxRows(scoped, sample.source.data, sample.now, (boardId) => sample.dismissed[boardId] ?? []).active.length;
  if (count === 0) return null;
  if (count > 99 && !plant.printHundred) return "99+";
  return String(count);
}

function underTest(sample: Sample): string | null {
  const scope = resolveBadgeScope(sample.pathname, sample.search.includes("view=all") ? "all" : "workspace");
  const count = computeInboxBadgeCount(sample.source, scope, badgeWorkspaceId(sample.workspaceId), sample.now, (boardId) => sample.dismissed[boardId] ?? []);
  return count === null ? null : formatInboxBadgeCount(count);
}

function mismatches(plant?: Plant, n = 10_000): number {
  const random = rng(SEED);
  let bad = 0;
  for (let i = 0; i < n; i += 1) {
    const sample = makeSample(random);
    if (judge(sample, plant) !== underTest(sample)) bad += 1;
  }
  return bad;
}

function bigSample(): Sample {
  const random = rng(1);
  const sample = makeSample(random);
  const tasks = Array.from({ length: 100 }, (_, i) => ({ id: `big${i}`, title: "b", status: "PENDING", boardId: "default-b", columnId: "blocked", createdAt: new Date(BASE - DAY).toISOString(), updatedAt: new Date(BASE - 1000).toISOString() }) as unknown as TaskInfo);
  const boards = [{ id: "default-b", name: "b", isDefault: true, columns: [{ id: "blocked", name: "Blocked", position: 0, stage: "blocked" }] } as unknown as KanbanBoardInfo];
  return { ...sample, source: { workspaces: [{ id: "default", title: "d" }], workspacesLoading: false, data: { default: { status: "ready", tasks, boards } } }, dismissed: {}, pathname: "/settings", search: "", workspaceId: null, now: BASE };
}

beforeEach(() => {
  window.localStorage.clear();
  resetAttentionDismissalsForTests();
});
afterEach(() => vi.unstubAllGlobals());

describe("F3 random cross-check (seed 0xc908dc70)", () => {
  it("planted error 1 (every path reads view=all) is caught", () => {
    expect(mismatches({ anyPathReadsViewAll: true })).toBeGreaterThan(0);
  });

  it("planted error 2 (100 printed as \"100\") is caught", () => {
    const sample = bigSample();
    expect(judge(sample, { printHundred: true })).toBe("100");
    expect(judge(sample, { printHundred: true })).not.toBe(underTest(sample));
  });

  it("10,000 samples: 0 mismatches", () => {
    expect(mismatches()).toBe(0);
  });

  it("the samples cover hidden, shown and all-scope badges", () => {
    const random = rng(SEED);
    let shown = 0;
    let hidden = 0;
    let allScopeShown = 0;
    for (let i = 0; i < 10_000; i += 1) {
      const sample = makeSample(random);
      const value = judge(sample);
      if (value === null) hidden += 1;
      else shown += 1;
      if (value !== null && sample.pathname.endsWith("/overview") && sample.search) allScopeShown += 1;
    }
    expect(shown).toBeGreaterThan(1000);
    expect(hidden).toBeGreaterThan(1000);
    expect(allScopeShown).toBeGreaterThan(100);
  });

  it("200 samples through the real hook + component match the pure function", () => {
    const random = rng(SEED ^ 0x5a5a);
    for (let i = 0; i < 200; i += 1) {
      const sample = makeSample(random);
      nav.pathname = sample.pathname;
      clock.now = sample.now;
      window.history.replaceState(null, "", `${sample.pathname}${sample.search}`);
      window.localStorage.clear();
      resetAttentionDismissalsForTests();
      for (const [boardId, keys] of Object.entries(sample.dismissed)) {
        window.localStorage.setItem(`routa.kanban.attentionDismissed.${boardId}`, JSON.stringify(keys));
      }
      const view = render(
        <I18nProvider>
          <InboxBadgeDataProvider {...sample.source}>
            <InboxNavBadge workspaceId={sample.workspaceId} variant="row" />
          </InboxBadgeDataProvider>
        </I18nProvider>,
      );
      const shown = view.queryByTestId("inbox-nav-badge")?.textContent ?? null;
      expect(shown, `sample ${i} ${sample.pathname}${sample.search}`).toBe(judge(sample));
      view.unmount();
    }
  });
});
