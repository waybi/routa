"use client";

import React from "react";
import { X } from "lucide-react";
import type { KanbanFileChangeItem } from "../kanban-file-changes-types";
import { parseUnifiedDiffPreview } from "../kanban-diff-preview";

interface KanbanInlineDiffViewerProps {
  file: KanbanFileChangeItem | null;
  diff?: string;
  loading?: boolean;
  error?: string;
  onClose: () => void;
  commitSha?: string;
  embedded?: boolean;
}

export function KanbanInlineDiffViewer({
  file,
  diff,
  loading = false,
  error,
  onClose,
  commitSha,
  embedded = false,
}: KanbanInlineDiffViewerProps) {
  if (!file) return null;
  const parsedDiff = diff ? parseUnifiedDiffPreview({ patch: diff }) : null;

  return (
    <div className={embedded ? "border-t border-default pt-2" : "rounded-lg border border-default bg-surface"}>
      {/* Header */}
      <div className={`flex items-center justify-between gap-3 ${embedded ? "border-b border-default px-0 pb-2" : "border-b border-default px-3 py-2"}`}>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-primary">
            {file.path}
          </div>
          {commitSha && (
            <div className="mt-0.5 text-[10px] text-secondary">
              Commit: {commitSha.substring(0, 7)}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-secondary transition hover:bg-hover hover:text-primary focus-visible:outline-2 focus-visible:outline-accent"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Content */}
      <div className="max-h-96 overflow-auto">
        {loading ? (
          <div className={`flex items-center justify-center text-xs text-secondary ${embedded ? "px-1 py-6" : "py-8"}`}>
            Loading diff...
          </div>
        ) : error ? (
          <div className={`${embedded ? "px-0 py-3" : "px-3 py-4"} text-xs text-danger`}>
            {error}
          </div>
        ) : !diff ? (
          <div className={`${embedded ? "px-0 py-3" : "px-3 py-4"} text-xs text-secondary`}>
            No diff available
          </div>
        ) : (
          <div className="font-mono text-[10px]">
            {parsedDiff?.lines.map((line, i) => {
              const getStyles = () => {
                const prefix = line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " ";

                if (line.kind === "add") {
                  return {
                    bgClass: "bg-success-subtle",
                    textClass: "text-success",
                    prefix,
                  };
                }
                if (line.kind === "remove") {
                  return {
                    bgClass: "bg-danger-subtle",
                    textClass: "text-danger",
                    prefix,
                  };
                }
                if (line.kind === "meta" || line.kind === "hunk") {
                  return {
                    bgClass: "bg-accent-subtle",
                    textClass: "text-information",
                    prefix: "",
                  };
                }
                return {
                  bgClass: "",
                  textClass: "text-secondary",
                  prefix,
                };
              };

              const { bgClass, textClass, prefix } = getStyles();

              return (
                <div
                  key={i}
                  className={`${embedded ? "px-0" : "px-3"} py-0.5 ${bgClass} ${textClass}`}
                >
                  {line.kind === "add" || line.kind === "remove" || line.kind === "context" ? (
                    <div className="grid grid-cols-[2rem_2rem_1rem_minmax(0,1fr)]">
                      <span className="select-none pr-1 text-right opacity-50">
                        {typeof line.oldLineNumber === "number" ? (
                          <span data-testid={`kanban-diff-old-line-${i}`}>{line.oldLineNumber}</span>
                        ) : ""}
                      </span>
                      <span className="select-none pr-1 text-right opacity-50">
                        {typeof line.newLineNumber === "number" ? (
                          <span data-testid={`kanban-diff-new-line-${i}`}>{line.newLineNumber}</span>
                        ) : ""}
                      </span>
                      <span className="select-none opacity-50">{prefix}</span>
                      <span className="whitespace-pre">{line.text.slice(1) || " "}</span>
                    </div>
                  ) : (
                    <span className="whitespace-pre">{line.text}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
