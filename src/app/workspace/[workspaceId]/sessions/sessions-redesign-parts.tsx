"use client";

import React, { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Search } from "lucide-react";

import { desktopAwareFetch } from "@/client/utils/diagnostics";

/**
 * Pieces shared by the redesigned sessions list and team pages
 * (design-spec §3 rows 5 and 7, §6 empty/loading/error states).
 */

export type ListStatus = "loading" | "ready" | "error";

export interface ListLoadState<T> {
  items: T[];
  status: ListStatus;
  /** True once at least one read has succeeded; used to keep the last good list on error. */
  loadedOnce: boolean;
  errorMessage: string | null;
  reload: () => void;
  setItems: React.Dispatch<React.SetStateAction<T[]>>;
}

/**
 * Reads a list endpoint. A failed read never clears the last good list
 * (design-spec §6: "失败不把旧数据清空").
 */
export function useListLoader<T>(
  url: string,
  pick: (data: unknown) => T[],
): ListLoadState<T> {
  const [items, setItems] = useState<T[]>([]);
  const [status, setStatus] = useState<ListStatus>("loading");
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const pickRef = useRef(pick);
  pickRef.current = pick;

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    (async () => {
      try {
        const res = await desktopAwareFetch(url, { cache: "no-store", signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: unknown = await res.json();
        if (controller.signal.aborted) return;
        setItems(pickRef.current(data));
        setLoadedOnce(true);
        setErrorMessage(null);
        setStatus("ready");
      } catch (error) {
        if (controller.signal.aborted) return;
        setErrorMessage(error instanceof Error ? error.message : String(error));
        setStatus("error");
      }
    })();
    return () => controller.abort();
  }, [url, refreshKey]);

  const reload = useCallback(() => setRefreshKey((current) => current + 1), []);

  return { items, status, loadedOnce, errorMessage, reload, setItems };
}

export function pickSessions<T>(data: unknown): T[] {
  const sessions = (data as { sessions?: unknown } | null)?.sessions;
  return Array.isArray(sessions) ? (sessions as T[]) : [];
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="m-0 text-[21px] font-semibold leading-tight text-primary">{title}</h1>
        <p className="m-0 mt-1 text-[13px] text-secondary">{description}</p>
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </header>
  );
}

export function SearchField({
  value,
  onChange,
  label,
  placeholder,
  testId,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  placeholder: string;
  testId?: string;
}) {
  return (
    <label className="relative block w-full max-w-[360px]">
      <span className="sr-only">{label}</span>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-secondary" aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        placeholder={placeholder}
        data-testid={testId}
        className="h-[34px] w-full rounded-control border border-default bg-surface pl-8 pr-3 text-[13px] text-primary placeholder:text-secondary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      />
    </label>
  );
}

/** Moves keyboard focus into the first editable field inside `container` and scrolls it into view. */
export function focusFirstEditable(container: HTMLElement | null): boolean {
  if (!container) return false;
  const target = container.querySelector<HTMLElement>('[contenteditable="true"], textarea, input:not([type="hidden"])');
  if (!target) return false;
  target.focus();
  target.scrollIntoView?.({ block: "center", behavior: "smooth" });
  return true;
}
