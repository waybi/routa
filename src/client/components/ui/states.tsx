"use client";

import type { ReactNode } from "react";
import { CircleAlert, Inbox } from "lucide-react";

import { useTranslation } from "@/i18n";
import { Button } from "./button";

/**
 * Empty / loading / error states from design-spec §6. Each says what is
 * missing and what to do next; loading keeps the layout stable and never
 * starts work by itself; error keeps a retry entry.
 */

export interface EmptyStateProps {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, action, icon, className = "" }: EmptyStateProps) {
  const { t } = useTranslation();
  return (
    <div
      data-testid="ui-empty-state"
      className={`grid justify-items-center gap-3 rounded-lg border border-dashed border-default px-6 py-14 text-center ${className}`.trim()}
    >
      <span className="text-secondary" aria-hidden="true">
        {icon ?? <Inbox className="h-8 w-8" strokeWidth={1.5} />}
      </span>
      <p className="m-0 text-[13px] font-semibold text-primary">{title ?? t.uiKit.emptyTitle}</p>
      {description ? <p className="m-0 max-w-[430px] text-xs leading-relaxed text-secondary">{description}</p> : null}
      {action ?? null}
    </div>
  );
}

export interface SkeletonProps {
  /** Number of placeholder lines. */
  lines?: number;
  label?: string;
  className?: string;
}

export function Skeleton({ lines = 3, label, className = "" }: SkeletonProps) {
  const { t } = useTranslation();
  return (
    <div role="status" aria-busy="true" data-testid="ui-skeleton" className={className}>
      <span className="sr-only">{label ?? t.uiKit.loading}</span>
      {Array.from({ length: lines }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          className="mb-4 h-[18px] animate-pulse rounded bg-subtle motion-reduce:animate-none"
          style={{ width: `${index === lines - 1 ? 60 : 100}%` }}
        />
      ))}
    </div>
  );
}

export interface ErrorStateProps {
  title?: ReactNode;
  /** The reason; shown under the title. */
  message?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export function ErrorState({ title, message, onRetry, retryLabel, className = "" }: ErrorStateProps) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      data-testid="ui-error-state"
      className={`rounded-lg border border-danger bg-danger-subtle p-6 ${className}`.trim()}
    >
      <p className="m-0 flex items-center gap-2 text-[13px] font-semibold text-danger">
        <CircleAlert className="h-4 w-4" aria-hidden="true" />
        {title ?? t.uiKit.errorTitle}
      </p>
      {message ? <p className="mb-4 mt-2 text-xs leading-relaxed text-primary">{message}</p> : null}
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry} className={message ? "" : "mt-3"}>
          {retryLabel ?? t.uiKit.retry}
        </Button>
      ) : null}
    </div>
  );
}
