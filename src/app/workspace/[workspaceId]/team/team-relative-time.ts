"use client";

import { useCallback } from "react";

import { useTranslation } from "@/i18n";

/**
 * Locale-aware relative time ("5 分钟前" / "5 minutes ago") for the team
 * pages. Returns "" for a missing or unparsable date so callers can show
 * their own "not recorded" copy.
 */
export function formatTeamRelativeTime(dateStr: string | undefined, locale: string | undefined, now = Date.now()): string {
  if (!dateStr) return "";
  const time = Date.parse(dateStr);
  if (Number.isNaN(time)) return "";
  const formatter = new Intl.RelativeTimeFormat(locale === "zh" ? "zh-CN" : "en", { numeric: "auto" });
  const diffSeconds = Math.round((time - now) / 1000);
  const abs = Math.abs(diffSeconds);
  if (abs < 60) return formatter.format(0, "second");
  if (abs < 3600) return formatter.format(Math.round(diffSeconds / 60), "minute");
  if (abs < 86400) return formatter.format(Math.round(diffSeconds / 3600), "hour");
  if (abs < 7 * 86400) return formatter.format(Math.round(diffSeconds / 86400), "day");
  return formatter.format(Math.round(diffSeconds / (7 * 86400)), "week");
}

export function useTeamRelativeTime(): (dateStr: string | undefined) => string {
  const { locale } = useTranslation();
  return useCallback((dateStr: string | undefined) => formatTeamRelativeTime(dateStr, locale), [locale]);
}

/** Full timestamp for title attributes. */
export function formatFullTime(dateStr: string | undefined): string {
  if (!dateStr) return "";
  const time = Date.parse(dateStr);
  return Number.isNaN(time) ? dateStr : new Date(time).toISOString();
}
