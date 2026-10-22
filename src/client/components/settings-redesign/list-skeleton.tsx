"use client";

import { Skeleton } from "../ui/states";

/**
 * Card-shaped loading placeholder for settings lists. Each row reuses the
 * same container classes as the real card so the layout does not jump when
 * data arrives.
 */
export function SettingsListSkeleton({
  rows = 2,
  cardClassName = "rounded-xl border border-default bg-surface p-4",
  className = "mt-2 space-y-3",
}: {
  rows?: number;
  cardClassName?: string;
  className?: string;
}) {
  return (
    <div data-testid="settings-list-skeleton" className={className}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className={cardClassName}>
          <Skeleton lines={3} />
        </div>
      ))}
    </div>
  );
}
