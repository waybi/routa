"use client";

import { useState, type ReactNode } from "react";
import type { useTranslation } from "@/i18n";

/**
 * Building blocks shared by the four card-detail tabs (design-spec §5
 * "详情抽屉"): a titled section, a label/value line, a small summary cell
 * and a native <details> disclosure. Colors come from the redesign tokens
 * only (src/app/globals.css), so light and dark themes stay in contrast.
 */

type Translate = ReturnType<typeof useTranslation>["t"];

export function DetailSection({
  title,
  description,
  action,
  children,
  compact = false,
  testId,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  compact?: boolean;
  testId?: string;
}) {
  return (
    <section className={`border-b border-default last:border-b-0 ${compact ? "space-y-2 py-3" : "space-y-3 py-4"}`} data-testid={testId}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="m-0 text-[13px] font-semibold text-primary">{title}</h3>
          {description ? <p className="m-0 mt-1 text-xs text-secondary">{description}</p> : null}
        </div>
        {action ?? null}
      </div>
      {children}
    </section>
  );
}

export function InlineSummary({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className={`flex items-start justify-between gap-3 border-b border-default px-1 ${compact ? "py-2" : "py-2.5"}`}>
      <div className="shrink-0 text-[11px] text-secondary">{label}</div>
      <div className={`min-w-0 text-right font-medium text-primary ${compact ? "text-[12px] leading-[1.1rem]" : "text-sm"}`}>
        {value}
      </div>
    </div>
  );
}

export function SummaryGridItem({
  label,
  value,
  detail,
  compact = false,
}: {
  label: string;
  value: string;
  detail?: string;
  compact?: boolean;
}) {
  return (
    <div className="space-y-0.5 rounded-md border border-default bg-surface px-2.5 py-2 text-sm">
      <div className="text-[11px] text-secondary">{label}</div>
      <div className="font-medium text-primary">{value}</div>
      {detail && !compact ? <div className="text-xs leading-5 text-secondary">{detail}</div> : null}
    </div>
  );
}

/**
 * Native details/summary: Space/Enter toggle it and it keeps a visible focus
 * ring. Children mount only while open, so a collapsed area (e.g. Advanced)
 * does not fire its option requests when the card opens.
 */
export function DetailDisclosure({
  summary,
  hint,
  children,
  defaultOpen = false,
  testId,
}: {
  summary: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  testId?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details open={open || undefined} className="group rounded-md border border-default bg-surface" data-testid={testId}>
      <summary
        onClick={(event) => {
          // Toggle in React state (synchronously); Space/Enter on the
          // focused summary fire this same click.
          event.preventDefault();
          setOpen((value) => !value);
        }}
        aria-expanded={open}
        className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-md px-3 py-2.5 hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold text-primary">{summary}</span>
          {hint ? <span className="mt-0.5 block text-xs text-secondary">{hint}</span> : null}
        </span>
        <span aria-hidden="true" className="shrink-0 text-xs text-secondary transition-transform group-open:rotate-90">›</span>
      </summary>
      {open ? <div className="space-y-3 border-t border-default px-3 py-3">{children}</div> : null}
    </details>
  );
}

export function formatDetailTimestamp(value?: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString();
}

export function formatCheckStatus(value: boolean | undefined, t: Translate): string {
  if (value === undefined) return t.kanbanDetail.pendingEvaluation;
  return value ? t.kanbanDetail.present : t.kanbanDetail.missing;
}
