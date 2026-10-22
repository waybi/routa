"use client";

/**
 * ⌘K / Ctrl+K command palette (design-spec §5, §8).
 *
 * Built on the native <dialog> with showModal(), so the browser handles
 * focus containment and Escape. Opens from anywhere — including while the
 * focus is inside an input. ↑/↓ choose, Enter navigates, Esc closes and
 * focus returns to the element that had it before opening.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

import { useTranslation } from "@/i18n";
import { buildCommandRouteEntries, filterCommandRouteEntries } from "./command-palette-routes";

export interface CommandPaletteProps {
  workspaceId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function isCommandPaletteShortcut(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k";
}

export function CommandPalette({ workspaceId, open, onOpenChange }: CommandPaletteProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const entries = useMemo(() => buildCommandRouteEntries(t, workspaceId), [t, workspaceId]);
  const results = useMemo(() => filterCommandRouteEntries(entries, query), [entries, query]);
  const copy = t.shell.commandPalette;

  // Sync the native dialog with the `open` prop.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      inputRef.current?.focus();
    } else if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }, [open]);

  const restoreFocus = useCallback(() => {
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    if (target && target.isConnected) target.focus();
  }, []);

  const close = useCallback(() => {
    onOpenChange(false);
    setQuery("");
    setActiveIndex(0);
    restoreFocus();
  }, [onOpenChange, restoreFocus]);

  // Global shortcut: capture phase so page-level handlers cannot swallow it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isCommandPaletteShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (open) {
        close();
      } else {
        onOpenChange(true);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [close, onOpenChange, open]);

  const go = useCallback(
    (index: number) => {
      const entry = results[index];
      if (!entry) return;
      returnFocusRef.current = null;
      onOpenChange(false);
      setQuery("");
      setActiveIndex(0);
      router.push(entry.href);
    },
    [onOpenChange, results, router],
  );

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (results.length > 0) setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length > 0) setActiveIndex((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(activeIndex);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  const activeId = results[activeIndex] ? `command-palette-option-${results[activeIndex].key}` : undefined;

  return (
    <dialog
      ref={dialogRef}
      aria-label={copy.title}
      data-testid="command-palette"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) close();
      }}
      className="m-auto mt-[12vh] w-[min(560px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-default bg-surface p-0 text-primary shadow-overlay backdrop:bg-black/50"
    >
      {open ? (
        <div className="flex max-h-[70vh] flex-col">
          <div className="flex items-center gap-2 border-b border-default px-3">
            <Search className="h-4 w-4 shrink-0 text-secondary" aria-hidden="true" />
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls="command-palette-results"
              aria-activedescendant={activeId}
              aria-label={copy.placeholder}
              placeholder={copy.placeholder}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={onInputKeyDown}
              className="h-11 w-full bg-transparent text-[13px] text-primary outline-none placeholder:text-secondary"
            />
          </div>
          {results.length === 0 ? (
            <p data-testid="command-palette-empty" className="m-0 px-4 py-8 text-center text-xs text-secondary">
              {copy.noResults}
            </p>
          ) : (
            <ul
              id="command-palette-results"
              role="listbox"
              aria-label={copy.resultsLabel}
              className="m-0 list-none overflow-y-auto p-1.5"
            >
              {results.map((entry, index) => {
                const active = index === activeIndex;
                return (
                  <li
                    key={entry.key}
                    id={`command-palette-option-${entry.key}`}
                    role="option"
                    aria-selected={active}
                    data-href={entry.href}
                    onMouseMove={() => setActiveIndex(index)}
                    onClick={() => go(index)}
                    className={`flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-[13px] ${
                      active ? "bg-accent-subtle text-primary" : "text-primary"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{entry.label}</span>
                      {entry.hint ? <span className="block text-[11px] text-secondary">{entry.hint}</span> : null}
                    </span>
                    <span className="shrink-0 text-[11px] text-secondary">{entry.groupLabel}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </dialog>
  );
}
