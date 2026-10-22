"use client";

/**
 * Board-level keyboard (design-spec §8):
 *   N            new card — not while typing, not while a dialog is open
 *   ↑ / ↓        previous / next card in the same column
 *   ← / →        nearest card in the neighbouring non-empty column
 *   Enter        opens the focused card (handled by the card itself)
 * "/" stays with useKanbanBoardSearch. Kept separate from
 * hooks/use-keyboard-shortcuts.ts, which belongs to the file-changes panel.
 */

import { useCallback, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { isEditableTarget } from "./kanban-board-search";

const CARD_SELECTOR = '[data-testid="kanban-card"][data-card-id]';
const ARROWS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

/** True when a modal layer is open: a dialog element or an aria-modal node. */
export function hasOpenDialog(root: Document = document): boolean {
  return Boolean(root.querySelector('dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]'));
}

/** Cards grouped by column, in DOM (render) order, columns left to right. */
export function collectCardGrid(container: HTMLElement): HTMLElement[][] {
  const columns: HTMLElement[][] = [];
  const indexByColumn = new Map<string, number>();
  container.querySelectorAll<HTMLElement>(CARD_SELECTOR).forEach((card) => {
    const columnId = card.dataset.columnId ?? "";
    let index = indexByColumn.get(columnId);
    if (index === undefined) {
      index = columns.length;
      indexByColumn.set(columnId, index);
      columns.push([]);
    }
    columns[index].push(card);
  });
  return columns;
}

/** The card to focus after pressing `key` on `current`, or null to stay put. */
export function nextCardFocus(grid: HTMLElement[][], current: HTMLElement, key: string): HTMLElement | null {
  const column = grid.findIndex((cards) => cards.includes(current));
  if (column < 0) return null;
  const row = grid[column].indexOf(current);
  switch (key) {
    case "ArrowDown":
      return grid[column][row + 1] ?? null;
    case "ArrowUp":
      return row > 0 ? grid[column][row - 1] : null;
    case "ArrowRight":
    case "ArrowLeft": {
      const target = grid[column + (key === "ArrowRight" ? 1 : -1)];
      if (!target || target.length === 0) return null;
      return target[Math.min(row, target.length - 1)];
    }
    default:
      return null;
  }
}

export function useKanbanBoardKeyboard({
  enabled,
  onNewCard,
}: {
  enabled: boolean;
  onNewCard?: () => void;
}) {
  const onNewCardRef = useRef(onNewCard);
  useEffect(() => {
    onNewCardRef.current = onNewCard;
  }, [onNewCard]);

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "n" && event.key !== "N") return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      if (isEditableTarget(event.target) || hasOpenDialog()) return;
      if (!onNewCardRef.current) return;
      event.preventDefault();
      onNewCardRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled]);

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (!ARROWS.has(event.key) || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement;
    if (!target.matches?.(CARD_SELECTOR)) return;
    const next = nextCardFocus(collectCardGrid(event.currentTarget), target, event.key);
    if (!next) return;
    event.preventDefault();
    next.focus();
  }, []);

  return { onKeyDown };
}
