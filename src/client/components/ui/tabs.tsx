"use client";

import { type KeyboardEvent, type ReactNode, useId, useRef } from "react";

export interface TabItem {
  id: string;
  label: ReactNode;
  content: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  /** Accessible name for the tab list. */
  label: string;
  className?: string;
  /** Extra classes for the tab row (e.g. horizontal padding). */
  listClassName?: string;
  /** Replaces the default panel classes (e.g. to let the panel fill height). */
  panelClassName?: string;
  /**
   * Render every panel and hide the unselected ones instead of unmounting
   * them, so panel state (drafts, scroll, subscriptions) survives switching.
   */
  keepMounted?: boolean;
  /**
   * Optional content at the end of the tab row (e.g. page-level controls).
   * Rendered next to the tab list, never inside `role="tablist"`, so arrow
   * keys and screen readers still see only the tabs. When omitted the DOM is
   * unchanged.
   */
  trailing?: ReactNode;
  /** Tighter vertical padding on the tab buttons (py-1.5 instead of py-2.5). */
  compact?: boolean;
}

/** 1px bottom line in the border colour, drawn inside the box. */
const BASELINE = "shadow-[inset_0_-1px_0_var(--color-default)]";

/**
 * WAI-ARIA tabs with roving tabindex: ←/→ move between enabled tabs and
 * wrap around, Home/End jump to the ends. Selection follows focus.
 */
export function Tabs({
  items,
  value,
  onChange,
  label,
  className = "",
  listClassName = "",
  panelClassName,
  keepMounted = false,
  trailing,
  compact = false,
}: TabsProps) {
  const baseId = useId();
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const enabled = items.filter((item) => !item.disabled);
  const selected = items.find((item) => item.id === value) ?? enabled[0];

  const focusTab = (id: string) => {
    onChange(id);
    tabRefs.current.get(id)?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (enabled.length === 0) return;
    const index = enabled.findIndex((item) => item.id === selected?.id);
    let next: TabItem | undefined;
    if (event.key === "ArrowRight") next = enabled[(index + 1) % enabled.length];
    else if (event.key === "ArrowLeft") next = enabled[(index - 1 + enabled.length) % enabled.length];
    else if (event.key === "Home") next = enabled[0];
    else if (event.key === "End") next = enabled[enabled.length - 1];
    if (!next) return;
    event.preventDefault();
    focusTab(next.id);
  };

  const hasTrailing = trailing !== undefined && trailing !== null;
  // The baseline is an inset shadow, not a border: tab buttons stay inside
  // the box (no -mb-px), so the tab list never overflows by 1px and never
  // grows a scrollbar when callers add overflow-x-auto or the OS shows
  // classic scrollbars. The selected tab's 2px underline paints over it.
  const tabList = (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={handleKeyDown}
      className={
        hasTrailing
          ? `flex shrink-0 gap-5 overflow-y-hidden ${listClassName}`.trim()
          : `flex gap-5 ${BASELINE} ${listClassName}`.trim()
      }
    >
      {items.map((item) => {
        const isSelected = item.id === selected?.id;
        return (
          <button
            key={item.id}
            ref={(node) => {
              if (node) tabRefs.current.set(item.id, node);
              else tabRefs.current.delete(item.id);
            }}
            type="button"
            role="tab"
            id={`${baseId}-tab-${item.id}`}
            aria-selected={isSelected}
            aria-controls={`${baseId}-panel-${item.id}`}
            tabIndex={isSelected ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange(item.id)}
            className={`shrink-0 whitespace-nowrap border-b-2 ${compact ? "py-1.5" : "py-2.5"} text-[13px] transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:opacity-50 ${
              isSelected ? "border-accent text-primary" : "border-transparent text-secondary hover:text-primary"
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className={className}>
      {hasTrailing ? (
        <div className={`flex min-w-0 shrink-0 items-stretch gap-3 ${BASELINE}`} data-testid="tabs-row">
          {tabList}
          {trailing}
        </div>
      ) : tabList}
      {keepMounted
        ? items.map((item) => (
          <div
            key={item.id}
            role="tabpanel"
            id={`${baseId}-panel-${item.id}`}
            aria-labelledby={`${baseId}-tab-${item.id}`}
            tabIndex={0}
            hidden={item.id !== selected?.id}
            className={`${panelClassName ?? "pt-4"} focus-visible:outline-2 focus-visible:outline-accent`}
          >
            {item.content}
          </div>
        ))
        : selected ? (
          <div
            role="tabpanel"
            id={`${baseId}-panel-${selected.id}`}
            aria-labelledby={`${baseId}-tab-${selected.id}`}
            tabIndex={0}
            className={`${panelClassName ?? "pt-4"} focus-visible:outline-2 focus-visible:outline-accent`}
          >
            {selected.content}
          </div>
        ) : null}
    </div>
  );
}
