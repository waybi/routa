"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { FileRow } from "../kanban-file-changes-panel";
import type { KanbanFileChangeItem } from "../kanban-file-changes-types";

interface KanbanFileChangesSectionProps {
  title: string;
  subtitle?: string;
  files: KanbanFileChangeItem[];
  embedded?: boolean;
  showCheckbox?: boolean;
  onFileClick?: (file: KanbanFileChangeItem) => void;
  onFileSelect?: (file: KanbanFileChangeItem, selected: boolean) => void;
  onSelectAll?: (selected: boolean) => void;
  actions?: React.ReactNode;
  defaultExpanded?: boolean;
  badge?: React.ReactNode;
}

export function KanbanFileChangesSection({
  title,
  subtitle,
  files,
  embedded = false,
  showCheckbox = false,
  onFileClick,
  onFileSelect,
  onSelectAll,
  actions,
  defaultExpanded = true,
  badge,
}: KanbanFileChangesSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  
  const selectedCount = files.filter(f => f.selected).length;
  const allSelected = files.length > 0 && selectedCount === files.length;
  const someSelected = selectedCount > 0 && selectedCount < files.length;

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    onSelectAll?.(e.target.checked);
  };

  return (
    <section className={embedded ? "py-1" : "rounded-xl border border-default bg-canvas"}>
      {/* Header */}
      <div className={`flex items-center justify-between gap-2 ${embedded ? "px-0 py-1.5" : "px-3 py-2"}`}>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-secondary" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-secondary" />
          )}
          
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-primary">
                {title}
              </span>
              {badge}
              <span className="text-[10px] text-secondary">
                ({files.length})
              </span>
            </div>
            {subtitle && (
              <div className="mt-0.5 text-[10px] text-secondary">
                {subtitle}
              </div>
            )}
          </div>
        </button>

        {showCheckbox && files.length > 0 && (
          <input
            type="checkbox"
            checked={allSelected}
            ref={(input) => {
              if (input) {
                input.indeterminate = someSelected;
              }
            }}
            onChange={handleSelectAll}
            className="h-3.5 w-3.5 rounded border-default accent-accent focus:ring-2 focus:ring-accent"
            aria-label="Select all files"
            title="Select all files"
          />
        )}
      </div>

      {/* Content */}
      {expanded && (
        <div className={`${embedded ? "border-t border-default px-0 py-2" : "border-t border-default px-3 py-2"}`}>
          {files.length === 0 ? (
            <div className={`${embedded ? "px-1 py-2 text-left" : "rounded-lg border border-dashed border-default bg-surface px-3 py-3"} text-[10px] text-secondary`}>
              No files in this section
            </div>
          ) : (
            <>
              <div className="space-y-1">
                {files.map((file) => (
                  <FileRow
                    key={`${file.path}-${file.status}`}
                    file={file}
                    selected={file.selected}
                    onClick={onFileClick}
                    onSelect={onFileSelect}
                    showCheckbox={showCheckbox}
                  />
                ))}
              </div>

              {actions && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {actions}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
