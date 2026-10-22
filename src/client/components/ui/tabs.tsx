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
}

/**
 * WAI-ARIA tabs with roving tabindex: ←/→ move between enabled tabs and
 * wrap around, Home/End jump to the ends. Selection follows focus.
 */
export function Tabs({ items, value, onChange, label, className = "" }: TabsProps) {
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

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={handleKeyDown}
        className="flex gap-5 border-b border-default"
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
              className={`-mb-px border-b-2 py-2.5 text-[13px] transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 ${
                isSelected ? "border-accent text-primary" : "border-transparent text-secondary hover:text-primary"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {selected ? (
        <div
          role="tabpanel"
          id={`${baseId}-panel-${selected.id}`}
          aria-labelledby={`${baseId}-tab-${selected.id}`}
          tabIndex={0}
          className="pt-4 focus-visible:outline-2 focus-visible:outline-accent"
        >
          {selected.content}
        </div>
      ) : null}
    </div>
  );
}
