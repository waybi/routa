"use client";

import type { ReactNode } from "react";

/**
 * Page header for settings pages and the re-shelled resource / developer
 * pages (design-spec §2): about 48px tall, 21px title, one line of
 * description, primary actions pinned to the right.
 */
type SettingsPageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  /** Primary actions, rendered on the right. */
  actions?: ReactNode;
  /** Optional row under the title (tabs, filters). */
  children?: ReactNode;
  className?: string;
};

export function SettingsPageHeader({ title, description, actions, children, className = "" }: SettingsPageHeaderProps) {
  return (
    <header
      data-testid="settings-page-header"
      className={`shrink-0 border-b border-default bg-canvas px-6 py-3 max-[800px]:px-4 ${className}`.trim()}
    >
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 truncate text-[21px] font-semibold leading-7 text-primary">{title}</h1>
          {description ? (
            <p className="m-0 mt-0.5 max-w-3xl text-xs leading-5 text-secondary">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2" data-testid="settings-page-header-actions">
            {actions}
          </div>
        ) : null}
      </div>
      {children ? <div className="mt-3">{children}</div> : null}
    </header>
  );
}
