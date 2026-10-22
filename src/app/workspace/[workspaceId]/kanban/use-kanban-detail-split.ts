"use client";

/**
 * The draggable divider between the board and the card detail panel: owns
 * the split ratio, persists it to localStorage, and wires the mouse-drag
 * lifecycle (cursor, text-selection lock, listeners).
 *
 * Extracted from `kanban-tab.tsx` (docs/REFACTOR.md: orchestration shell +
 * domain hooks). Fully self-contained: no board state flows in.
 */

import { useEffect, useRef, useState } from "react";

// v2: the redesigned detail (card 3/6) defaults to a ~390px session column
// at 1440px wide (design-spec §7); the old 0.48 ratio is not carried over.
const STORAGE_KEY = "routa:kanban-detail-split-ratio:v2";
const MIN_RATIO = 0.4;
const MAX_RATIO = 0.82;
const DEFAULT_RATIO = 0.73;

function clampRatio(ratio: number): number {
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
}

/** Reads the persisted ratio synchronously so the first paint uses it. */
function readStoredRatio(): number {
  if (typeof window === "undefined") return DEFAULT_RATIO;
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    // Number(null) is 0, which would clamp to MIN_RATIO; no value means default.
    const stored = raw ? Number(raw) : Number.NaN;
    return Number.isFinite(stored) ? clampRatio(stored) : DEFAULT_RATIO;
  } catch {
    return DEFAULT_RATIO;
  }
}

export function useKanbanDetailSplit() {
  const [detailSplitRatio, setDetailSplitRatio] = useState(readStoredRatio);
  const [isDraggingDetailSplit, setIsDraggingDetailSplit] = useState(false);
  const detailSplitContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage?.setItem(STORAGE_KEY, String(detailSplitRatio));
    } catch {
      // Storage may be unavailable (private mode, quota); the in-memory value still works.
    }
  }, [detailSplitRatio]);

  useEffect(() => {
    if (!isDraggingDetailSplit) return;

    const handleMouseMove = (event: MouseEvent) => {
      const container = detailSplitContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0) return;
      setDetailSplitRatio(clampRatio((event.clientX - rect.left) / rect.width));
    };

    const handleMouseUp = () => setIsDraggingDetailSplit(false);

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDraggingDetailSplit]);

  return { detailSplitRatio, isDraggingDetailSplit, setIsDraggingDetailSplit, detailSplitContainerRef };
}
