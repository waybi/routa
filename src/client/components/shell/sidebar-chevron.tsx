import React from "react";

/** Small chevron in front of a foldable sidebar heading; points down when expanded. */
export function SidebarChevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`h-3.5 w-3.5 shrink-0 transition-transform duration-150 motion-reduce:transition-none ${expanded ? "rotate-90" : ""}`}
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

/** Heading button classes shared by the Projects, Resources and Developer sections. */
export const SIDEBAR_FOLD_BUTTON_CLASS =
  "flex min-h-[28px] items-center gap-1.5 rounded-md px-2.5 py-1 text-left text-[11px] font-semibold text-secondary transition-colors duration-150 motion-reduce:transition-none hover:bg-hover hover:text-primary focus-visible:outline-2 focus-visible:outline-accent";
