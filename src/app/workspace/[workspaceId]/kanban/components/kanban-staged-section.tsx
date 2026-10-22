"use client";

import React from "react";
import { ChevronDown, Download, GitCommitHorizontal } from "lucide-react";
import { KanbanFileChangesSection } from "./kanban-file-changes-section";
import type { KanbanFileChangeItem } from "../kanban-file-changes-types";

interface KanbanStagedSectionProps {
  files: KanbanFileChangeItem[];
  onFileClick?: (file: KanbanFileChangeItem) => void;
  onFileSelect?: (file: KanbanFileChangeItem, selected: boolean) => void;
  onSelectAll?: (selected: boolean) => void;
  onUnstageSelected: () => void;
  onCommit: () => void;
  onExport: () => void;
  loading?: boolean;
}

export function KanbanStagedSection({
  files,
  onFileClick,
  onFileSelect,
  onSelectAll,
  onUnstageSelected,
  onCommit,
  onExport,
  loading = false,
}: KanbanStagedSectionProps) {
  const selectedCount = files.filter(f => f.selected).length;
  const hasSelection = selectedCount > 0;
  const hasFiles = files.length > 0;

  const badge = (
    <span className="text-[9px] font-medium text-success">
      APPROVED
    </span>
  );

  const actions = (
    <>
      <button
        type="button"
        onClick={onUnstageSelected}
        disabled={!hasSelection || loading}
        className="flex items-center gap-1 rounded-md border border-default bg-surface px-2 py-1 text-[10px] font-medium text-primary transition hover:bg-hover disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-accent"
      >
        Unstage {hasSelection ? `(${selectedCount})` : "Selected"}
      </button>

      <button
        type="button"
        onClick={onCommit}
        disabled={!hasFiles || loading}
        className="flex items-center gap-1 rounded-md border border-success bg-success-subtle px-2 py-1 text-[10px] font-medium text-success transition hover:bg-success-subtle disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-accent"
      >
        <GitCommitHorizontal className="h-3 w-3" />
        <ChevronDown className="h-3 w-3" />
        Commit
      </button>

      <button
        type="button"
        onClick={onExport}
        disabled={!hasFiles || loading}
        className="flex items-center gap-1 rounded-md border border-accent bg-accent-subtle px-2 py-1 text-[10px] font-medium text-information transition hover:bg-accent-subtle disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Download className="h-3 w-3" />
        Export
      </button>
    </>
  );

  return (
    <KanbanFileChangesSection
      title="STAGED"
      subtitle={files.length > 0 ? `${files.length} file${files.length === 1 ? '' : 's'} ready to commit` : undefined}
      files={files}
      showCheckbox={true}
      onFileClick={onFileClick}
      onFileSelect={onFileSelect}
      onSelectAll={onSelectAll}
      actions={actions}
      badge={badge}
      defaultExpanded={true}
    />
  );
}
