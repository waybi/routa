/**
 * Lane status color by column stage. Colors live in globals.css as
 * `--lane-<stage>` (one set per theme); components only reference the
 * variable, so a column's color follows its stage, never its display name.
 */

export const KANBAN_LANE_TONES = ["backlog", "todo", "dev", "review", "done", "blocked"] as const;

export type KanbanLaneTone = (typeof KANBAN_LANE_TONES)[number];

const KNOWN = new Set<string>(KANBAN_LANE_TONES);

/** The stage itself when it is one of the six known stages; otherwise backlog (grey). */
export function resolveLaneTone(stage: string | null | undefined): KanbanLaneTone {
  return stage && KNOWN.has(stage) ? (stage as KanbanLaneTone) : "backlog";
}

/** CSS color reference for a stage, e.g. `var(--lane-dev)`. */
export function laneToneVar(stage: string | null | undefined): string {
  return `var(--lane-${resolveLaneTone(stage)})`;
}
