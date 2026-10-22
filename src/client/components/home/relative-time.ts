"use client";

import { useSyncExternalStore } from "react";
import type { HomeTranslationDictionarySections } from "@/i18n/types-home";

type RelativeCopy = Pick<
  HomeTranslationDictionarySections["homeRedesign"],
  "justNow" | "minutesAgo" | "hoursAgo" | "daysAgo" | "timeUnknown"
>;

/** "3 h ago" style text; `null` / 0 means the time was never recorded. */
export function formatRelativeTime(at: number | null | undefined, now: number, copy: RelativeCopy): string {
  if (!at) return copy.timeUnknown;
  const mins = Math.floor(Math.max(0, now - at) / 60_000);
  if (mins < 1) return copy.justNow;
  if (mins < 60) return copy.minutesAgo.replace("{count}", String(mins));
  const hours = Math.floor(mins / 60);
  if (hours < 24) return copy.hoursAgo.replace("{count}", String(hours));
  return copy.daysAgo.replace("{count}", String(Math.floor(hours / 24)));
}

/** Wall clock rounded down to the minute; 0 on the server and before hydration. */
function readMinute(): number {
  return Math.floor(Date.now() / 60_000) * 60_000;
}

function subscribeMinute(listener: () => void): () => void {
  const id = window.setInterval(listener, 15_000);
  return () => window.clearInterval(id);
}

/**
 * Minute clock for relative times. A fixed value (tests) wins. The server
 * snapshot is 0 so the first client render matches SSR; callers treat 0 as
 * "not ready".
 */
export function useMinuteClock(fixed?: number): number {
  const now = useSyncExternalStore(subscribeMinute, readMinute, () => 0);
  return fixed ?? now;
}

/** Workspace id from the URL; static export serves every id as __placeholder__. */
export function resolveRouteWorkspaceId(raw: string | undefined): string {
  const value = raw ?? "";
  if (value === "__placeholder__" && typeof window !== "undefined") {
    return decodeURIComponent(window.location.pathname.match(/^\/workspace\/([^/]+)/)?.[1] ?? value);
  }
  return value;
}
