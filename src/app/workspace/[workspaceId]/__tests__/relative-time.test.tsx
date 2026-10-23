import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/i18n";
import { LOCALE_STORAGE_KEY } from "@/i18n/types";

import { formatRelativeTime, type RelativeTimeCopy } from "../ui-components";
import { SessionsOverview } from "../sessions-overview";
import { SessionContextPanel } from "@/client/components/session-context-panel";

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));

vi.mock("@/client/utils/diagnostics", () => ({
  desktopAwareFetch: mockFetch,
  shouldSuppressTeardownError: () => false,
}));
vi.mock("@/client/components/confirm-dialog", () => ({ useConfirm: () => vi.fn() }));
vi.mock("@/client/components/toast", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const NOW = new Date("2026-10-23T12:00:00.000Z").getTime();

function ago(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

function setLocale(locale: "en" | "zh") {
  localStorage.setItem(LOCALE_STORAGE_KEY, locale);
}

/**
 * Independent judge written from the requirement: floor to the unit, then
 * fill the template. Not derived from the implementation.
 */
const TEMPLATES = {
  en: { now: "now", m: "{n}m ago", h: "{n}h ago", d: "{n}d ago", w: "{n}w ago" },
  zh: { now: "刚刚", m: "{n} 分钟前", h: "{n} 小时前", d: "{n} 天前", w: "{n} 周前" },
} as const;

function judge(diffMs: number, locale: "en" | "zh"): { unit: string; n: number; text: string } {
  const tpl = TEMPLATES[locale];
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return { unit: "now", n: 0, text: tpl.now };
  if (minutes < 60) return { unit: "m", n: minutes, text: tpl.m.replace("{n}", String(minutes)) };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: "h", n: hours, text: tpl.h.replace("{n}", String(hours)) };
  const days = Math.floor(hours / 24);
  if (days < 7) return { unit: "d", n: days, text: tpl.d.replace("{n}", String(days)) };
  const weeks = Math.floor(days / 7);
  return { unit: "w", n: weeks, text: tpl.w.replace("{n}", String(weeks)) };
}

/** Deterministic PRNG so failures are reproducible. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleDiffs(count: number): number[] {
  const rand = mulberry32(20261023);
  const boundaries = [60_000, 3_600_000, 86_400_000, 7 * 86_400_000];
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    if (i % 2 === 0) {
      const b = boundaries[i % boundaries.length];
      out.push(Math.max(0, b + Math.floor((rand() - 0.5) * 4_000)));
    } else {
      out.push(Math.floor(rand() * 60 * 86_400_000));
    }
  }
  return out;
}

describe("formatRelativeTime follows the UI locale", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it("prints Chinese minutes / hours when the locale is zh", () => {
    setLocale("zh");
    expect(formatRelativeTime(ago(8 * 60_000))).toBe("8 分钟前");
    expect(formatRelativeTime(ago(3 * 3_600_000))).toBe("3 小时前");
    expect(formatRelativeTime(ago(10_000))).toBe("刚刚");
  });

  it("keeps the English short form when the locale is en", () => {
    setLocale("en");
    expect(formatRelativeTime(ago(8 * 60_000))).toBe("8m ago");
    expect(formatRelativeTime(ago(30_000))).toBe("now");
  });

  it("uses the copy passed by the caller", () => {
    setLocale("zh");
    const copy: RelativeTimeCopy = {
      justNow: "J",
      minutesAgo: "M{count}",
      hoursAgo: "H{count}",
      daysAgo: "D{count}",
      weeksAgo: "W{count}",
    };
    expect(formatRelativeTime(ago(8 * 60_000), copy)).toBe("M8");
    expect(formatRelativeTime(ago(15 * 86_400_000), copy)).toBe("W2");
  });

  it("matches the independent judge on 10,000 random gaps in both locales", () => {
    const diffs = sampleDiffs(10_000);
    const mismatches: string[] = [];
    for (const locale of ["en", "zh"] as const) {
      setLocale(locale);
      for (const diff of diffs) {
        const expected = judge(diff, locale).text;
        const actual = formatRelativeTime(ago(diff));
        if (actual !== expected) mismatches.push(`${locale} ${diff}: ${actual} != ${expected}`);
      }
    }
    // zh and en must pick the same unit and number for every gap.
    for (const diff of diffs) {
      const en = judge(diff, "en");
      const zh = judge(diff, "zh");
      expect([zh.unit, zh.n]).toEqual([en.unit, en.n]);
    }
    expect(mismatches.slice(0, 5)).toEqual([]);
  });
});

describe("relative time in rendered lists", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    localStorage.clear();
    mockFetch.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it("SessionsOverview shows Chinese relative times and no 'ago' in zh", () => {
    setLocale("zh");
    const { container } = render(
      <I18nProvider>
        <SessionsOverview
          sessions={[
            { sessionId: "abc12345-0000", name: "Fix login", provider: "dsh", role: "CRAFTER", workspaceId: "default", cwd: "/", createdAt: ago(8 * 60_000) },
          ] as never}
          workspaceId="default"
          onNavigate={vi.fn()}
          onRefresh={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(screen.getByText("8 分钟前")).toBeTruthy();
    expect(container.textContent).toContain("分钟前");
    expect(container.textContent).not.toMatch(/ago/);
  });

  it("SessionContextPanel shows Chinese relative times in zh", async () => {
    setLocale("zh");
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        current: { sessionId: "s-current", name: "Current", cwd: "/", workspaceId: "default", provider: "dsh", role: "CRAFTER", createdAt: ago(3 * 3_600_000) },
        parent: { sessionId: "s-parent", name: "Parent one", cwd: "/", workspaceId: "default", createdAt: ago(2 * 86_400_000) },
        children: [],
        siblings: [],
        recentInWorkspace: [],
      }),
    });
    const { container } = render(
      <I18nProvider>
        <SessionContextPanel sessionId="s-current" workspaceId="default" onSelectSession={vi.fn()} />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByText("3 小时前")).toBeTruthy());
    expect(container.textContent).toContain("父会话");
    expect(container.textContent).toContain("2 天前");
    expect(container.textContent).not.toMatch(/\d+[mhd] ago|just now/);
  });
});
