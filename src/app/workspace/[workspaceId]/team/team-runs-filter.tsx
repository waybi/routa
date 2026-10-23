"use client";

import React from "react";

import { RUN_FILTERS, type RunFilter } from "./team-page-model";
import { FOCUS_RING } from "./team-roster";
import type { TeamRedesignCopy } from "./team-status-labels";

export function runFilterLabel(filter: RunFilter, copy: TeamRedesignCopy): string {
  switch (filter) {
    case "active": return copy.runs.filterActive;
    case "ended": return copy.runs.filterEnded;
    case "error": return copy.runs.filterError;
    default: return copy.runs.filterAll;
  }
}

/** Status segments for the run records: All / Running / Ended / Errors, each with its count. */
export function TeamRunsFilter({
  copy,
  value,
  counts,
  onChange,
}: {
  copy: TeamRedesignCopy;
  value: RunFilter;
  counts: Record<RunFilter, number>;
  onChange: (next: RunFilter) => void;
}) {
  return (
    <div
      role="group"
      aria-label={copy.runs.filterLabel}
      data-testid="team-runs-filter"
      className="inline-flex max-w-full flex-wrap rounded-[7px] border border-default bg-surface p-0.5"
    >
      {RUN_FILTERS.map((filter) => {
        const active = value === filter;
        return (
          <button
            key={filter}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(filter)}
            data-testid={`team-runs-filter-${filter}`}
            className={`inline-flex min-h-[26px] items-center gap-1 rounded-[5px] px-2.5 py-0.5 text-xs ${active ? "bg-subtle text-primary shadow-sm" : "text-secondary hover:text-primary"} ${FOCUS_RING}`}
          >
            <span>{runFilterLabel(filter, copy)}</span>
            <span className="text-[10.5px] tabular-nums text-secondary" data-filter-count>{counts[filter]}</span>
          </button>
        );
      })}
    </div>
  );
}

/** No team runs at all: how a run works in three steps, and a button that focuses the launch box. */
export function TeamRunsEmpty({
  copy,
  title,
  description,
  onWriteFirst,
}: {
  copy: TeamRedesignCopy;
  title: string;
  description: string;
  onWriteFirst: () => void;
}) {
  const steps = [
    { title: copy.runs.step1Title, body: copy.runs.step1Body },
    { title: copy.runs.step2Title, body: copy.runs.step2Body },
    { title: copy.runs.step3Title, body: copy.runs.step3Body },
  ];
  return (
    <div
      className="flex flex-col items-center gap-4 rounded-[10px] border border-default bg-surface px-6 pb-7 pt-8 text-center"
      data-testid="team-runs-empty"
    >
      <div>
        <h3 className="m-0 text-sm font-semibold text-primary">{title}</h3>
        <p className="m-0 mt-1 text-xs text-secondary">{description}</p>
        <p className="m-0 mt-1 text-xs text-secondary">{copy.runs.emptyLead}</p>
      </div>
      <ol className="m-0 flex list-none flex-wrap items-stretch justify-center gap-2.5 p-0">
        {steps.map((step, index) => (
          <li key={step.title} className="flex items-center gap-2.5">
            {index > 0 ? <span aria-hidden="true" className="text-secondary">→</span> : null}
            <div className="w-[200px] rounded-[10px] border border-default bg-canvas px-3.5 py-3 text-left">
              <span className="font-mono text-[10.5px] text-accent">{String(index + 1).padStart(2, "0")}</span>
              <b className="mb-0.5 mt-1 block text-[13px] text-primary">{step.title}</b>
              <p className="m-0 text-[11.5px] leading-relaxed text-secondary">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={onWriteFirst}
        data-testid="team-runs-write-first"
        className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-control border border-accent bg-accent px-3 py-1.5 text-[13px] font-semibold text-on-accent hover:opacity-90 ${FOCUS_RING}`}
      >
        {copy.runs.writeFirstTask}
      </button>
    </div>
  );
}
