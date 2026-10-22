"use client";

import React from "react";
import { GitCommitHorizontal, Trash2 } from "lucide-react";
import { KanbanFileChangesSection } from "./kanban-file-changes-section";
import type { KanbanFileChangeItem } from "../kanban-file-changes-types";

interface KanbanUnstagedSectionProps {
  files: KanbanFileChangeItem[];
  autoCommit: boolean;
  onAutoCommitToggle: (enabled: boolean) => void;
  embedded?: boolean;
  onFileClick?: (file: KanbanFileChangeItem) => void;
  onFileSelect?: (file: KanbanFileChangeItem, selected: boolean) => void;
  onSelectAll?: (selected: boolean) => void;
  onStageSelected: () => void;
  onDiscardSelected: () => void;
  loading?: boolean;
}

export function KanbanUnstagedSection({
  files,
  autoCommit,
  onAutoCommitToggle,
  embedded = false,
  onFileClick,
  onFileSelect,
  onSelectAll,
  onStageSelected,
  onDiscardSelected,
  loading = false,
}: KanbanUnstagedSectionProps) {
  const selectedCount = files.filter(f => f.selected).length;
  const hasSelection = selectedCount > 0;

  const badge = autoCommit ? (
    <span className="rounded-full bg-success-subtle px-1.5 py-0.5 text-[9px] font-medium text-success">
      Auto-commit
    </span>
  ) : (
    <span className="text-[9px] font-medium text-attention">
      NEW
    </span>
  );

  const actions = (
    <>
      <button
        type="button"
        onClick={onStageSelected}
        disabled={!hasSelection || loading}
        className="flex items-center gap-1 rounded-md border border-attention bg-attention-subtle px-2 py-1 text-[10px] font-medium text-attention transition hover:bg-attention-subtle disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-accent"
      >
        <GitCommitHorizontal className="h-3 w-3" />
        Stage {hasSelection ? `(${selectedCount})` : "Selected"}
      </button>

      <button
        type="button"
        onClick={onDiscardSelected}
        disabled={!hasSelection || loading}
        className="flex items-center gap-1 rounded-md border border-danger bg-danger-subtle px-2 py-1 text-[10px] font-medium text-danger transition hover:bg-danger-subtle disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Trash2 className="h-3 w-3" />
        Discard {hasSelection ? `(${selectedCount})` : "Selected"}
      </button>

      <label className="ml-auto flex items-center gap-1.5 text-[10px] text-secondary">
        <input
          type="checkbox"
          checked={autoCommit}
          disabled={true}
          onChange={(e) => onAutoCommitToggle(e.target.checked)}
          className="h-3 w-3 rounded border-default text-success opacity-50 focus:ring-1 focus:ring-success disabled:cursor-not-allowed"
        />
        <span className="opacity-50">Auto-commit</span>
      </label>
    </>
  );

  return (
    <KanbanFileChangesSection
      title="UNSTAGED"
      subtitle={files.length > 0 ? `${files.length} file${files.length === 1 ? '' : 's'} with changes` : undefined}
      files={files}
      embedded={embedded}
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
