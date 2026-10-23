"use client";

/**
 * Narrow columns (empty columns, collapsed Done) adapt to the board width:
 * when the board has room they are ~88px wide with horizontal text; when it
 * does not they fall back to ~40px rails with vertical text. One mode for the
 * whole board.
 *
 * The decision compares the board container width with the width the board
 * would need if every narrow column were horizontal. It never looks at the
 * narrow columns' own current width, so switching modes cannot flip the
 * decision back.
 */

import { useLayoutEffect, useState } from "react";

export type RailMode = "horizontal" | "vertical";

/** Width of a horizontal narrow column, in px (matches EMPTY_COLUMN_RAIL_WIDTH). */
export const RAIL_HORIZONTAL_PX = 88;
/** Width of a vertical narrow column, in px (matches EMPTY_COLUMN_RAIL_VERTICAL_WIDTH). */
export const RAIL_VERTICAL_PX = 40;
/** A column with cards is never narrower than this. */
export const MIN_LANE_PX = 210;
/** Gap between board columns (gap-3). */
export const BOARD_COLUMN_GAP_PX = 12;
/**
 * Going back from vertical to horizontal needs this much spare room, so a
 * container width that wobbles around the threshold does not flip the mode.
 */
export const RAIL_MODE_HYSTERESIS_PX = 16;

export interface RailLayout {
  /** Number of narrow columns (empty columns plus a collapsed Done). */
  railCount: number;
  /** Width of every column that has cards, in px; each counts as at least MIN_LANE_PX. */
  laneWidthsPx: number[];
  /** Space after the last column (e.g. pr-4 = 16). */
  trailingPx?: number;
  gapPx?: number;
}

/** Width the board needs when every narrow column is horizontal. */
export function requiredHorizontalWidth({ railCount, laneWidthsPx, trailingPx = 0, gapPx = BOARD_COLUMN_GAP_PX }: RailLayout): number {
  const columnCount = railCount + laneWidthsPx.length;
  const lanes = laneWidthsPx.reduce((sum, width) => sum + Math.max(MIN_LANE_PX, width), 0);
  return lanes + railCount * RAIL_HORIZONTAL_PX + Math.max(0, columnCount - 1) * gapPx + trailingPx;
}

/**
 * Pick the narrow column mode for a container width.
 * - No previous mode: horizontal when the board fits exactly or with room.
 * - Previously horizontal: stays horizontal while it fits; 1px short → vertical.
 * - Previously vertical: needs RAIL_MODE_HYSTERESIS_PX of spare room to go back.
 */
export function resolveRailMode({
  containerWidth,
  previousMode,
  hysteresisPx = RAIL_MODE_HYSTERESIS_PX,
  ...layout
}: RailLayout & { containerWidth: number; previousMode?: RailMode; hysteresisPx?: number }): RailMode {
  if (layout.railCount === 0) return previousMode ?? "horizontal";
  const required = requiredHorizontalWidth(layout);
  const threshold = previousMode === "vertical" ? required + hysteresisPx : required;
  return containerWidth >= threshold ? "horizontal" : "vertical";
}

/**
 * Watch a board container with ResizeObserver and return the narrow column
 * mode for it, plus a callback ref to put on the container. Before the first
 * measurement (and in environments without layout, such as tests) the mode is
 * horizontal.
 */
export function useRailMode<T extends HTMLElement>(layout: RailLayout): [RailMode, (element: T | null) => void] {
  const [element, setElement] = useState<T | null>(null);
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const [mode, setMode] = useState<RailMode>("horizontal");

  useLayoutEffect(() => {
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[entries.length - 1]?.contentRect.width ?? 0;
      if (width > 0) setContainerWidth(width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  const next = containerWidth === null ? mode : resolveRailMode({ ...layout, containerWidth, previousMode: mode });
  // Derived state with memory (hysteresis): adjust during render, React re-renders once.
  if (next !== mode) setMode(next);
  return [next, setElement];
}
