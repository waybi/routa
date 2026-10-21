"use client";

/**
 * Board search: one query box that filters every column. Matching is
 * case-insensitive literal substring (no regex), so highlighting splits with
 * indexOf and never needs escaping.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "@/i18n";
import type { TaskInfo } from "../types";

export function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase();
}

/**
 * A card matches when any of: title contains, id starts with, a `req:` label
 * contains, report excerpt contains, report commit contains.
 */
export function matchTask(
  task: Pick<TaskInfo, "id" | "title" | "labels" | "completionReport">,
  query: string,
): boolean {
  const needle = normalizeSearchQuery(query);
  if (!needle) return true;
  const contains = (value: string | null | undefined) => Boolean(value && value.toLowerCase().includes(needle));
  return contains(task.title)
    || task.id.toLowerCase().startsWith(needle)
    || (task.labels ?? []).some((label) => label.toLowerCase().startsWith("req:") && contains(label))
    || contains(task.completionReport?.excerpt)
    || contains(task.completionReport?.commit);
}

export interface HighlightPart {
  text: string;
  hit: boolean;
}

/** Splits `text` into hit / non-hit parts for a literal, case-insensitive query. */
export function splitHighlight(text: string, query: string): HighlightPart[] {
  const needle = normalizeSearchQuery(query);
  if (!needle || !text) return text ? [{ text, hit: false }] : [];
  const haystack = text.toLowerCase();
  const parts: HighlightPart[] = [];
  let cursor = 0;
  let index = haystack.indexOf(needle, cursor);
  while (index !== -1) {
    if (index > cursor) parts.push({ text: text.slice(cursor, index), hit: false });
    parts.push({ text: text.slice(index, index + needle.length), hit: true });
    cursor = index + needle.length;
    index = haystack.indexOf(needle, cursor);
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), hit: false });
  return parts;
}

export function HighlightedText({ text, query }: { text: string; query: string }): ReactNode {
  return splitHighlight(text, query).map((part, index) => (part.hit
    ? (
      <mark key={index} className="rounded-sm bg-amber-200/80 px-0.5 text-inherit dark:bg-amber-500/30" data-testid="kanban-search-mark">
        {part.text}
      </mark>
    )
    : <span key={index}>{part.text}</span>));
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== "string") return false;
  const element = target as HTMLElement;
  const tag = element.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || element.isContentEditable;
}

/** Query state plus the "/" focus shortcut (skipped while typing elsewhere). */
export function useKanbanBoardSearch() {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.defaultPrevented || isEditableTarget(event.target)) return;
      if (!inputRef.current) return;
      event.preventDefault();
      inputRef.current.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const clear = useCallback(() => setQuery(""), []);
  return { query, setQuery, clear, inputRef };
}

export function KanbanBoardSearchInput({
  query,
  onQueryChange,
  onClear,
  inputRef,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onClear: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const { t } = useTranslation();
  return (
    <label className="flex h-7 w-64 shrink-0 items-center border border-slate-200 bg-white transition-colors focus-within:border-amber-400/80 focus-within:ring-2 focus-within:ring-amber-400/15 dark:border-slate-700 dark:bg-[#12141c]">
      <Search className="ml-2 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClear();
          }
        }}
        placeholder={t.kanbanSearch.placeholder}
        aria-label={t.kanbanSearch.placeholder}
        title={t.kanbanSearch.shortcutHint}
        autoComplete="off"
        className="h-7 min-w-0 flex-1 bg-transparent px-2 text-[12px] text-slate-800 placeholder-slate-400 outline-none dark:text-slate-200 dark:placeholder-slate-500"
        data-testid="kanban-board-search"
      />
      <kbd className="mr-1.5 rounded border border-slate-200 px-1 font-mono text-[10px] text-slate-400 dark:border-slate-700 dark:text-slate-500">/</kbd>
    </label>
  );
}
