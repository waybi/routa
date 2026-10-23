"use client";

import type { ReactNode } from "react";
import type { useTranslation } from "@/i18n";

/**
 * Building blocks shared by the card-detail tabs (design-spec §5
 * "详情抽屉"): a titled section, a label/value line and a small summary
 * cell. Colors come from the redesign tokens
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

export function formatDetailTimestamp(value?: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString();
}

export function formatCheckStatus(value: boolean | undefined, t: Translate): string {
  if (value === undefined) return t.kanbanDetailRedesign.pendingEvaluation;
  return value ? t.kanbanDetail.present : t.kanbanDetail.missing;
}
