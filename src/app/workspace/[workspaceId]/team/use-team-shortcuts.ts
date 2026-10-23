"use client";

import { useEffect, useRef } from "react";

/** True when the key press belongs to a text field: input, textarea, select or any contenteditable (the tiptap editor). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest("input, textarea, select")) return true;
  return Boolean(target.closest('[contenteditable]:not([contenteditable="false"])'));
}

/**
 * Team page shortcuts: N focuses the launch box, / focuses the run search.
 * Skipped while typing (fields, contenteditable, IME composition), with
 * Ctrl/Meta/Alt held, or while `disabled` (the member drawer is open).
 * Listens on window only while the page is mounted.
 */
export function useTeamShortcuts({ onLaunch, onSearch, disabled }: {
  onLaunch: () => void;
  onSearch: () => void;
  disabled: boolean;
}) {
  const latest = useRef({ onLaunch, onSearch, disabled });
  useEffect(() => {
    latest.current = { onLaunch, onSearch, disabled };
  }, [onLaunch, onSearch, disabled]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (latest.current.disabled || isEditableTarget(event.target)) return;
      if (event.key === "n" || event.key === "N") {
        event.preventDefault();
        latest.current.onLaunch();
      } else if (event.key === "/") {
        event.preventDefault();
        latest.current.onSearch();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
