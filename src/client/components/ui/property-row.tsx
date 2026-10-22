"use client";

import type { ReactNode } from "react";

export interface PropertyRowProps {
  label: ReactNode;
  children: ReactNode;
  /** Render the value in the monospace face (ids, commit hashes, paths). */
  mono?: boolean;
  className?: string;
}

/**
 * Label/value row used in detail side panels. Rendered as a <div> pair
 * inside a definition-list friendly structure; wrap rows in <dl>.
 */
export function PropertyRow({ label, children, mono = false, className = "" }: PropertyRowProps) {
  return (
    <div className={`grid grid-cols-[minmax(84px,auto)_1fr] items-baseline gap-3 py-1.5 ${className}`.trim()}>
      <dt className="text-[11px] text-secondary">{label}</dt>
      <dd className={`m-0 min-w-0 break-words text-xs text-primary ${mono ? "font-mono" : ""}`.trim()}>{children}</dd>
    </div>
  );
}
