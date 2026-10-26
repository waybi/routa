import type { CSSProperties } from "react";
import { laneToneVar, resolveLaneTone } from "./kanban-lane-tone";

/**
 * Decorative status marker in front of a column / block title.
 * Light: 8x8 solid square dot (radius 2px). Dark: 10x10 ring with a 2px
 * border; Done is filled, Backlog is dashed. The theme switch is pure CSS
 * (`dark:` variant), so the first paint is already right.
 */
export function KanbanLaneMarker({ stage }: { stage: string | null | undefined }) {
  const tone = resolveLaneTone(stage);
  const fill = tone === "done" ? "dark:bg-[color:var(--lane-marker)]" : "dark:bg-transparent";
  const dashed = tone === "backlog" ? "dark:border-dashed" : "dark:border-solid";
  return (
    <span
      aria-hidden="true"
      data-testid="kanban-lane-marker"
      data-lane-tone={tone}
      style={{ "--lane-marker": laneToneVar(stage) } as CSSProperties}
      className={`inline-block size-2 shrink-0 rounded-[2px] bg-[color:var(--lane-marker)] dark:size-2.5 dark:rounded-full dark:border-2 dark:border-[color:var(--lane-marker)] ${fill} ${dashed}`}
    />
  );
}
