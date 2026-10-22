"use client";

import React from "react";
import { useTranslation } from "@/i18n";
import { Button } from "./button";

export type TraceViewTab = "chat" | "event-bridge";

interface TracesViewTabsProps {
  activeTab: TraceViewTab;
  onTabChange: (tab: TraceViewTab) => void;
  className?: string;
}

const TAB_DEFINITIONS: Array<{ key: TraceViewTab }> = [
  { key: "chat" },
  { key: "event-bridge" },
];

export function TracesViewTabs({ activeTab, onTabChange, className }: TracesViewTabsProps) {
  const { t } = useTranslation();
  return (
    <div className={className ?? ""}>
      <div
        className="inline-flex items-center gap-0.5 rounded-control border border-default bg-subtle p-0.5"
        data-testid="traces-view-tabs"
      >
        {TAB_DEFINITIONS.map(({ key }) => (
          <Button
            key={key}
            type="button"
            variant={activeTab === key ? "secondary" : "ghost"}
            size="xs"
            onClick={() => onTabChange(key)}
            aria-pressed={activeTab === key}
            className="px-3 py-1.5 text-xs font-semibold"
          >
            {key === "chat" ? t.traces.chat : t.traces.traceTab}
          </Button>
        ))}
      </div>
    </div>
  );
}
