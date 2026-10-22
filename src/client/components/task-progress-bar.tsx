"use client";

/**
 * TaskProgressBar - Collapsible task progress indicator for ACP Claude Code tasks.
 *
 * Shows a compact summary of task progress above the input area.
 * - Collapsed: Shows current running task (e.g., "Todos (3/5) Analyzing codebase...")
 * - Expanded: Shows all tasks with their statuses
 * - Footer: Shows file changes summary (e.g., "📁 5 files changed +286 -45")
 */

import { useState, useMemo } from "react";
import { ChevronDown } from "lucide-react";


export interface TaskInfo {
  id: string;
  title: string;
  description?: string;
  subagentType?: string;
  /** Task status: "pending", "running", "delegated" (async running), "completed", or "failed" */
  status: "pending" | "running" | "delegated" | "completed" | "failed";
  /** Completion summary when task finishes */
  completionSummary?: string;
}

export interface FileChangesSummary {
  fileCount: number;
  totalAdded: number;
  totalRemoved: number;
}

interface TaskProgressBarProps {
  tasks: TaskInfo[];
  fileChanges?: FileChangesSummary;
  className?: string;
}

export function TaskProgressBar({ tasks, fileChanges, className = "" }: TaskProgressBarProps) {
  const [expanded, setExpanded] = useState(false);

  // Find current running task and calculate progress
  const { completedCount, runningTask } = useMemo(() => {
    let runningIdx = -1;
    let completed = 0;
    let running: TaskInfo | null = null;

    for (let i = 0; i < tasks.length; i++) {
      if (tasks[i].status === "completed") {
        completed++;
      }
      // "delegated" means async running - treat as running for display
      if ((tasks[i].status === "running" || tasks[i].status === "delegated") && runningIdx === -1) {
        runningIdx = i;
        running = tasks[i];
      }
    }

    // If no running task, show the first pending one
    if (runningIdx === -1) {
      for (let i = 0; i < tasks.length; i++) {
        if (tasks[i].status === "pending") {
          runningIdx = i;
          running = tasks[i];
          break;
        }
      }
    }

    return {
      currentTaskIndex: runningIdx >= 0 ? runningIdx + 1 : completed + 1,
      completedCount: completed,
      runningTask: running,
    };
  }, [tasks]);

  // Show component if we have tasks or file changes
  if (tasks.length === 0 && !fileChanges) return null;

  const allCompleted = tasks.length > 0 && completedCount === tasks.length;
  const progressPercent = tasks.length > 0 ? (completedCount / tasks.length) * 100 : 0;

  return (
    <div className={`w-full ${className}`}>
      <div className="rounded-lg border border-default bg-subtle overflow-hidden">
        {/* Header - always visible */}
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-hover transition-colors"
        >
          {/* Progress indicator with Todos label */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={`w-2 h-2 rounded-full ${allCompleted ? "bg-success" : "bg-attention animate-pulse"}`} />
            {tasks.length > 0 && (
              <span className="text-xs font-medium text-secondary">
                Todos ({completedCount}/{tasks.length})
              </span>
            )}
          </div>

          {/* Current task title */}
          <span className="text-xs text-primary truncate flex-1">
            {runningTask?.title || (allCompleted ? "All tasks completed" : fileChanges ? "" : "Tasks")}
          </span>

          {/* File changes summary in header (compact) */}
          {fileChanges && (
            <span className="text-[10px] text-secondary shrink-0 flex items-center gap-1">
              <span>📁 {fileChanges.fileCount}</span>
              <span className="text-success">+{fileChanges.totalAdded}</span>
              <span className="text-danger">-{fileChanges.totalRemoved}</span>
            </span>
          )}

          {/* Expand/collapse icon */}
          <ChevronDown className={`w-3 h-3 text-secondary transition-transform duration-200 shrink-0 ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
        </button>

        {/* Progress bar - only show if we have tasks */}
        {tasks.length > 0 && (
          <div className="h-0.5 bg-default">
            <div
              className="h-full bg-success transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}

        {/* Expanded task list */}
        {expanded && tasks.length > 0 && (
          <div className="border-t border-default max-h-48 overflow-y-auto">
            {tasks.map((task, index) => (
              <TaskRow key={task.id} task={task} index={index} />
            ))}
          </div>
        )}

        {/* File changes footer - show when expanded or when no tasks */}
        {expanded && fileChanges && fileChanges.fileCount > 0 && (
          <div className="border-t border-default px-3 py-2 flex items-center gap-2">
            <span className="text-xs text-secondary">📁</span>
            <span className="text-xs text-primary">
              {fileChanges.fileCount} file{fileChanges.fileCount !== 1 ? "s" : ""} changed
            </span>
            <span className="text-xs text-success font-medium">
              +{fileChanges.totalAdded}
            </span>
            <span className="text-xs text-danger font-medium">
              -{fileChanges.totalRemoved}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function TaskRow({ task, index }: { task: TaskInfo; index: number }) {
  const statusConfig: Record<TaskInfo["status"], { color: string; label: string }> = {
    pending: { color: "bg-secondary", label: "pending" },
    running: { color: "bg-attention animate-pulse", label: "running" },
    delegated: { color: "bg-accent animate-pulse", label: "delegated" },
    completed: { color: "bg-success", label: "done" },
    failed: { color: "bg-danger", label: "failed" },
  };

  const { color, label } = statusConfig[task.status];

  return (
    <div className="px-3 py-2 flex items-center gap-2 hover:bg-hover transition-colors">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${color}`} />
      <span className="text-[10px] font-medium text-secondary shrink-0">
        #{index + 1}
      </span>
      {task.subagentType && (
        <span className="text-[10px] font-medium text-attention shrink-0">
          [{task.subagentType}]
        </span>
      )}
      <span className="text-xs text-primary truncate flex-1">
        {task.title || task.description || "Task"}
      </span>
      <span className="text-[10px] text-secondary shrink-0">
        {label}
      </span>
      {/* Show completion summary for completed tasks */}
      {task.status === "completed" && task.completionSummary && (
        <span className="text-[10px] text-success truncate max-w-[120px]" title={task.completionSummary}>
          ✓ {task.completionSummary.slice(0, 30)}...
        </span>
      )}
    </div>
  );
}
