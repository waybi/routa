"use client";

import React, { useState } from "react";
import { GitCommit, ChevronDown, ChevronRight, ExternalLink, RotateCcw } from "lucide-react";
import { FileRow } from "../kanban-file-changes-panel";
import type { KanbanCommitInfo, KanbanFileChangeItem } from "../kanban-file-changes-types";

interface KanbanCommitsSectionProps {
  commits: KanbanCommitInfo[];
  onFileClick?: (file: KanbanFileChangeItem, commitSha: string) => void;
  onOpenCommit?: (commit: KanbanCommitInfo) => void;
  onRevertCommit?: (commit: KanbanCommitInfo) => void;
  expanded?: boolean;
  onToggle?: () => void;
  loading?: boolean;
}

export function KanbanCommitsSection({
  commits,
  onFileClick,
  onOpenCommit,
  onRevertCommit,
  expanded = false,
  onToggle,
  loading = false,
}: KanbanCommitsSectionProps) {
  const [expandedCommits, setExpandedCommits] = useState<Set<string>>(new Set());

  const toggleCommit = (sha: string) => {
    setExpandedCommits((prev) => {
      const next = new Set(prev);
      if (next.has(sha)) {
        next.delete(sha);
      } else {
        next.add(sha);
      }
      return next;
    });
  };

  return (
    <section className="rounded-2xl border border-default bg-canvas">
      {/* Header */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left focus-visible:outline-2 focus-visible:outline-accent"
      >
        <div className="flex items-center gap-2">
          <GitCommit className="h-4 w-4 text-secondary" />
          <span className="text-sm font-semibold text-primary">
            COMMITS
          </span>
          <span className="text-xs text-secondary">
            ({commits.length})
          </span>
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-secondary" />
        ) : (
          <ChevronRight className="h-4 w-4 text-secondary" />
        )}
      </button>

      {/* Content */}
      {expanded && (
      <div className="border-t border-default px-3.5 py-3">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-secondary">
            Loading commits...
          </div>
        ) : commits.length === 0 ? (
          <div className="rounded-xl border border-dashed border-default bg-surface px-3 py-4 text-center text-[11px] text-secondary">
            No commits yet
          </div>
        ) : (
          <div className="space-y-2">
            {commits.map((commit) => {
              const isExpanded = expandedCommits.has(commit.sha);
              const hasFiles = commit.files && commit.files.length > 0;

              return (
                <div
                  key={commit.sha}
                  className="rounded-lg border border-default bg-surface"
                >
                  {/* Commit Header */}
                  <div className="flex items-start gap-2 p-2">
                    {hasFiles && (
                      <button
                        type="button"
                        onClick={() => toggleCommit(commit.sha)}
                        className="mt-0.5 shrink-0"
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5 text-secondary" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 text-secondary" />
                        )}
                      </button>
                    )}
                    
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-2">
                        <GitCommit className="mt-0.5 h-3.5 w-3.5 shrink-0 text-information" />
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] font-medium text-primary">
                            {commit.summary}
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[10px] text-secondary">
                            <span className="font-mono">{commit.shortSha}</span>
                            <span>·</span>
                            <span>{commit.authorName}</span>
                            {commit.additions > 0 && (
                              <>
                                <span>·</span>
                                <span className="text-success">
                                  +{commit.additions}
                                </span>
                              </>
                            )}
                            {commit.deletions > 0 && (
                              <>
                                <span className="text-danger">
                                  -{commit.deletions}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1">
                      {onOpenCommit && (
                        <button
                          type="button"
                          onClick={() => onOpenCommit(commit)}
                          className="rounded p-1 text-secondary transition hover:bg-hover hover:text-primary"
                          title="Open in editor"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </button>
                      )}
                      {onRevertCommit && (
                        <button
                          type="button"
                          onClick={() => onRevertCommit(commit)}
                          className="rounded p-1 text-secondary transition hover:bg-hover hover:text-danger"
                          title="Revert commit"
                        >
                          <RotateCcw className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expanded Files */}
                  {isExpanded && hasFiles && (
                    <div className="border-t border-default bg-canvas px-2 py-2">
                      <div className="space-y-1">
                        {commit.files!.map((file) => (
                          <FileRow
                            key={file.path}
                            file={file}
                            onClick={() => onFileClick?.(file, commit.sha)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      )}
    </section>
  );
}
