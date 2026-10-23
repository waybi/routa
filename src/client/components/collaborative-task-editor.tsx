"use client";

/**
 * CollaborativeTaskEditor - Real-time collaborative task editing panel.
 *
 * Displays task notes from the Notes system with real-time SSE updates.
 * When ROUTA creates tasks, they appear here and can be edited by
 * both the user and agents simultaneously (CRDT-backed).
 *
 * Features:
 * - Live task list synced from server Notes
 * - Inline editing with debounced save
 * - Real-time updates from agents via SSE
 * - Visual indicators for agent vs user changes
 * - Task status management
 */

import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { desktopAwareFetch } from "../utils/diagnostics";
import type { NoteData } from "../hooks/use-notes";
import { MarkdownViewer } from "./markdown/markdown-viewer";
import { type CrafterAgent, CraftersView } from "./task-panel";
import { Select } from "./select";
import { useTranslation } from "@/i18n";
import type { TranslationDictionary } from "@/i18n";
import { Check, ChevronDown, FileText, X, Zap } from "lucide-react";


type CollabPanelView = "tasks" | "crafters";

interface CollaborativeTaskEditorProps {
  notes: NoteData[];
  connected: boolean;
  onUpdateNote: (
    noteId: string,
    update: { title?: string; content?: string; metadata?: Record<string, unknown> }
  ) => Promise<NoteData | null>;
  onDeleteNote?: (noteId: string) => Promise<void>;
  /** The workspace ID for context */
  workspaceId?: string;
  /** CRAFTER agents spawned from tasks */
  crafterAgents?: CrafterAgent[];
  /** Callback when user clicks a task note that may map to a crafter */
  onSelectTaskNote?: (noteId: string) => void;
  /** Execute a single task note */
  onExecuteTask?: (noteId: string) => Promise<unknown>;
  /** Execute a selected subset of task notes */
  onExecuteSelected?: (noteIds: string[], concurrency: number) => Promise<void>;
  /** Execute all pending task notes */
  onExecuteAll?: (concurrency: number) => void;
  /** Current concurrency setting */
  concurrency?: number;
  /** Callback when concurrency changes */
  onConcurrencyChange?: (n: number) => void;
}

export function CollaborativeTaskEditor({
  notes,
  connected,
  onUpdateNote,
  onDeleteNote,
  workspaceId: _workspaceId,
  crafterAgents = [],
  onSelectTaskNote,
  onExecuteTask,
  onExecuteSelected,
  onExecuteAll,
  concurrency = 1,
  onConcurrencyChange,
}: CollaborativeTaskEditorProps) {
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null);
  const [specExpanded, setSpecExpanded] = useState(true);
  const [viewMode, _setViewMode] = useState<CollabPanelView>("tasks");
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
  const { t } = useTranslation();

  const containerRef = useRef<HTMLDivElement>(null);

  // Filter task notes (spec is now shown in the dedicated Spec tab)
  const taskNotes = useMemo(
    () => notes.filter((n) => n.metadata.type === "task"),
    [notes]
  );

  const hasPending = taskNotes.some(
    (n) => !n.metadata.taskStatus || n.metadata.taskStatus === "PENDING"
  );
  const runningCrafterCount = crafterAgents.filter((agent) => agent.status === "running").length;
  const hasRunning = taskNotes.some((n) => n.metadata.taskStatus === "IN_PROGRESS") || runningCrafterCount > 0;

  const pendingNotes = taskNotes.filter(
    (n) => !n.metadata.taskStatus || n.metadata.taskStatus === "PENDING"
  );

  const toggleNoteSelection = (noteId: string) => {
    setSelectedNoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedNoteIds.size === pendingNotes.length) {
      setSelectedNoteIds(new Set());
    } else {
      setSelectedNoteIds(new Set(pendingNotes.map((n) => n.id)));
    }
  };

  const handleExecuteSelected = async () => {
    if (!onExecuteSelected) return;
    const ids = Array.from(selectedNoteIds);
    setSelectedNoteIds(new Set());
    await onExecuteSelected(ids, concurrency);
  };

  // Find spec note
  const specNote = useMemo(() => notes.find((n) => n.metadata.type === "spec"), [notes]);

  // Vertical resize for spec panel
  const [specHeight, setSpecHeight] = useState(200);
  const handleVerticalResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = specHeight;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = moveEvent.clientY - startY;
      setSpecHeight(Math.max(100, Math.min(600, startHeight + deltaY)));
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [specHeight]);

  // Active crafter tracking
  const activeCrafterId = useMemo(() => {
    if (!onSelectTaskNote) return null;
    const expandedNote = taskNotes.find((n) => n.id === expandedNoteId);
    if (!expandedNote) return null;
    const crafter = crafterAgents.find((a) => a.taskId === expandedNote.id);
    return crafter?.sessionId ?? null;
  }, [expandedNoteId, taskNotes, crafterAgents, onSelectTaskNote]);

  const onSelectCrafter = useCallback((sessionId: string) => {
    const crafter = crafterAgents.find((a) => a.sessionId === sessionId);
    if (crafter?.taskId) {
      setExpandedNoteId(crafter.taskId);
      onSelectTaskNote?.(crafter.taskId);
    }
  }, [crafterAgents, onSelectTaskNote]);

  if (taskNotes.length === 0) {
    return null;
  }

  return (
    <div ref={containerRef} className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-default">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-primary">
              {t.tasks.collaborativeTasks}
            </span>
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-success-subtle text-success">
              {taskNotes.length}
            </span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5">
            {hasRunning && (
              <span className="text-xs font-medium text-attention animate-pulse">
                {t.collaborativeTasks.executing}{runningCrafterCount > 0 ? ` (${runningCrafterCount})` : ""}...
              </span>
            )}
            {pendingNotes.length > 0 && !hasRunning && (
              <button
                onClick={toggleSelectAll}
                className="text-xs font-medium px-2 py-1 rounded-md bg-subtle text-primary hover:bg-hover transition-colors"
              >
                {selectedNoteIds.size === pendingNotes.length ? t.tasks.deselectAll : t.tasks.selectAll}
              </button>
            )}
            {selectedNoteIds.size > 0 && !hasRunning && onExecuteTask && (
              <button
                onClick={handleExecuteSelected}
                className="text-xs font-medium px-2.5 py-1 rounded-md bg-accent text-on-accent hover:opacity-90 transition-colors"
              >
                {t.tasks.executeSelected} ({selectedNoteIds.size})
              </button>
            )}
            {hasPending && !hasRunning && onExecuteAll && (
              <button
                onClick={() => onExecuteAll(concurrency)}
                className="text-xs font-medium px-2.5 py-1 rounded-md bg-success text-on-accent hover:opacity-90 transition-colors"
              >
                {t.tasks.executeAll}
              </button>
            )}
            {/* Connection indicator */}
            <div className="flex items-center gap-1">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  connected ? "bg-success" : "bg-secondary"
                }`}
              />
              <span className="text-[10px] text-secondary">
                {connected ? t.collaborativeTasks.live : t.collaborativeTasks.off}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-subtle text-secondary">
            {t.collaborativeTasks.crdt}
          </span>
          <span className="text-[10px] font-medium text-secondary">
            {t.tasks.concurrency}
          </span>
          <div className="flex items-center rounded-md border border-default overflow-hidden">
            {[1, 2].map((n) => (
              <button
                key={n}
                onClick={() => onConcurrencyChange?.(n)}
                className={`px-2 py-0.5 text-[11px] font-medium transition-colors ${
                  concurrency === n
                    ? "bg-success text-on-accent"
                    : "bg-surface text-secondary hover:bg-hover"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-3 space-y-2">
          {taskNotes.map((note, index) => (
            <TaskNoteCard
              key={note.id}
              note={note}
              index={index}
              expanded={expandedNoteId === note.id}
              editing={editingNoteId === note.id}
              selected={selectedNoteIds.has(note.id)}
              onToggleSelect={() => toggleNoteSelection(note.id)}
              onToggleExpand={() => {
                onSelectTaskNote?.(note.id);
                setExpandedNoteId((prev) =>
                  prev === note.id ? null : note.id
                );
              }}
              onEdit={() => setEditingNoteId(note.id)}
              onCancelEdit={() => setEditingNoteId(null)}
              onSave={async (update) => {
                await onUpdateNote(note.id, update);
                setEditingNoteId(null);
              }}
              onDelete={
                onDeleteNote
                  ? () => onDeleteNote(note.id)
                  : undefined
              }
              onStatusChange={async (status) => {
                await onUpdateNote(note.id, {
                  metadata: { ...note.metadata, taskStatus: status },
                });
              }}
              onExecute={
                onExecuteTask
                  ? () => onExecuteTask(note.id)
                  : undefined
              }
            />
          ))}

          {taskNotes.length === 0 && (
            <div className="text-center py-8 text-xs text-secondary">
              <div className="space-y-1.5">
                <div className="text-sm">{t.collaborativeTasks.noTaskNotes}</div>
                <div>{t.collaborativeTasks.tasksWillAppear}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Spec Note (if exists) - resizable vertical split */}
      {specNote && specNote.content && (
        <div
          className="shrink-0 flex flex-col bg-accent-subtle relative"
          style={{ height: specExpanded ? `${specHeight}px` : "auto" }}
        >
          {/* Spec Header */}
          <div
            className="flex items-center gap-1.5 px-3 py-2 cursor-pointer hover:bg-accent-subtle transition-colors shrink-0"
            onClick={() => setSpecExpanded((prev) => !prev)}
          >
            <FileText className="w-3 h-3 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
            <span className="text-[10px] font-semibold text-accent flex-1">
              Spec
            </span>
            {onDeleteNote && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteNote(specNote.id);
                }}
                title={t.sessionDetailRedesign.taskEditor.deleteSpec}
                className="p-0.5 rounded text-secondary hover:text-danger hover:bg-danger-subtle transition-colors"
              >
                <X className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
              </button>
            )}
            <ChevronDown className={`w-3.5 h-3.5 text-accent transition-transform ${specExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          </div>
          {/* Spec Content */}
          {specExpanded ? (
            <div className="flex-1 overflow-y-auto px-3 pb-2">
              <MarkdownViewer
                content={specNote.content}
                className="text-[11px] text-secondary"
              />
            </div>
          ) : (
            <div className="px-3 pb-2">
              <div className="text-[11px] text-secondary line-clamp-2">
                <MarkdownViewer
                  content={specNote.content.slice(0, 200) + (specNote.content.length > 200 ? "..." : "")}
                  className="text-[11px]"
                />
              </div>
            </div>
          )}
          {/* Vertical resize handle - only show when expanded */}
          {specExpanded && (
            <div
              className="absolute left-0 right-0 bottom-0 h-1 cursor-row-resize z-20 hover:bg-accent active:bg-accent transition-colors group"
              onMouseDown={handleVerticalResizeStart}
            >
              <div className="absolute left-1/2 bottom-0 -translate-x-1/2 w-8 h-1 rounded-full bg-default group-hover:bg-accent group-active:bg-accent transition-colors" />
            </div>
          )}
        </div>
      )}
      {/* Divider between SPEC and Tasks when SPEC exists and is expanded */}
      {specNote && specNote.content && specExpanded && (
        <div className="h-px bg-default shrink-0" />
      )}

      {/* Content */}
      {viewMode === "tasks" ? (
        /* ─── Task Notes List ─────────────────────────── */
        <div className="flex-1 overflow-y-auto">
          <div className="p-3 space-y-2">
            {taskNotes.map((note, index) => (
              <TaskNoteCard
                key={note.id}
                note={note}
                index={index}
                expanded={expandedNoteId === note.id}
                editing={editingNoteId === note.id}
                selected={selectedNoteIds.has(note.id)}
                onToggleSelect={() => toggleNoteSelection(note.id)}
                onToggleExpand={() =>
                  setExpandedNoteId((prev) =>
                    prev === note.id ? null : note.id
                  )
                }
                onEdit={() => setEditingNoteId(note.id)}
                onCancelEdit={() => setEditingNoteId(null)}
                onSave={async (update) => {
                  await onUpdateNote(note.id, update);
                  setEditingNoteId(null);
                }}
                onDelete={
                  onDeleteNote
                    ? () => onDeleteNote(note.id)
                    : undefined
                }
                onStatusChange={async (status) => {
                  await onUpdateNote(note.id, {
                    metadata: { ...note.metadata, taskStatus: status },
                  });
                }}
                onExecute={
                  onExecuteTask
                    ? () => onExecuteTask(note.id)
                    : undefined
                }
                executeDisabled={concurrency <= 1 && hasRunning}
              />
            ))}

            {taskNotes.length === 0 && (
              <div className="text-center py-8 text-xs text-secondary">
                <div className="space-y-1.5">
                  <div className="text-sm">{t.collaborativeTasks.noTaskNotes}</div>
                  <div>{t.collaborativeTasks.tasksWillAppear}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ─── CRAFTERs View ───────────────────────────── */
        <CraftersView
          agents={crafterAgents}
          activeCrafterId={activeCrafterId}
          onSelectCrafter={onSelectCrafter}
        />
      )}
    </div>
  );
}

// ─── Task Note Card ────────────────────────────────────────────────────

interface TaskNoteCardProps {
  note: NoteData;
  index: number;
  expanded: boolean;
  editing: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  onToggleExpand: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (update: { title?: string; content?: string }) => Promise<void>;
  onDelete?: () => void;
  onStatusChange: (status: string) => Promise<void>;
  onExecute?: () => void;
  executeDisabled?: boolean;
}

function getStatusLabels(t: TranslationDictionary): Record<string, { label: string; color: string; bg: string }> {
  return {
    PENDING: {
      label: t.collaborativeTasks.status.pending,
      color: "text-secondary",
      bg: "bg-subtle border-default",
    },
    IN_PROGRESS: {
      label: t.collaborativeTasks.status.inProgress,
      color: "text-attention",
      bg: "bg-attention-subtle border-attention",
    },
    COMPLETED: {
      label: t.collaborativeTasks.status.completed,
      color: "text-success",
      bg: "bg-success-subtle border-success",
    },
    FAILED: {
      label: t.collaborativeTasks.status.failed,
      color: "text-danger",
      bg: "bg-danger-subtle border-danger",
    },
  };
}

// ─── Parse task content into structured sections ────────────────────────────
interface ParsedTaskSections {
  objective?: string;
  scope?: string;
  inputs?: string;
  outputs?: string;
  definitionOfDone?: string;
  remainingContent?: string;
}

const SECTION_NAMES = ["Objective", "Scope", "Inputs", "Outputs", "Definition of Done", "Acceptance Criteria"];

function parseTaskContent(content: string): ParsedTaskSections {
  const sections: ParsedTaskSections = {};
  let remaining = content;

  // Map section names to their normalized keys
  const sectionKeyMap: Record<string, keyof ParsedTaskSections> = {
    "objective": "objective",
    "scope": "scope",
    "inputs": "inputs",
    "outputs": "outputs",
    "definitionofdone": "definitionOfDone",
    "acceptancecriteria": "definitionOfDone",
  };

  for (const name of SECTION_NAMES) {
    const pattern = new RegExp(
      `(?:^|\\n)(?:#+\\s*)?(?:\\*\\*)?${name}(?:\\*\\*)?[:\\s]*\\n([\\s\\S]*?)(?=(?:\\n(?:#+\\s*)?(?:\\*\\*)?(?:${SECTION_NAMES.join("|")})(?:\\*\\*)?[:\\s]*\\n)|$)`,
      "i"
    );
    const match = content.match(pattern);
    if (match) {
      const rawKey = name.toLowerCase().replace(/\s+/g, "");
      const normalizedKey = sectionKeyMap[rawKey];
      if (normalizedKey) {
        sections[normalizedKey] = match[1].trim();
        remaining = remaining.replace(match[0], "");
      }
    }
  }

  // Get remaining content that's not in any section
  remaining = remaining.trim();
  if (remaining && !sections.objective) {
    // If no objective found, treat remaining as objective
    sections.objective = remaining;
  } else if (remaining) {
    sections.remainingContent = remaining;
  }

  return sections;
}

// ─── Section Component for task content ─────────────────────────────────────
function TaskSection({ title, content }: { title: string; content: string }) {
  return (
    <div className="mb-2.5 last:mb-0">
      <div className="text-[10px] font-semibold text-secondary mb-1 flex items-center gap-1.5">
        <span className="w-1 h-1 rounded-full bg-secondary" />
        {title}
      </div>
      <div className="text-xs text-secondary pl-2.5 border-l border-default">
        <MarkdownViewer content={content} className="text-xs" />
      </div>
    </div>
  );
}

// ─── Task Content Renderer ──────────────────────────────────────────────────
function TaskContentRenderer({ content }: { content: string }) {
  const { t } = useTranslation();
  if (!content) {
    return (
      <div className="text-xs text-secondary italic">
        {t.sessionDetailRedesign.taskEditor.noContent}
      </div>
    );
  }

  const sections = parseTaskContent(content);
  const hasSections = sections.objective || sections.scope || sections.inputs ||
                      sections.outputs || sections.definitionOfDone;

  if (!hasSections) {
    // No structured sections found, render as plain markdown
    return (
      <div className="text-xs text-secondary">
        <MarkdownViewer content={content} className="text-xs" />
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {sections.objective && (
        <TaskSection title={t.sessionDetailRedesign.taskEditor.objective} content={sections.objective} />
      )}
      {sections.scope && (
        <TaskSection title={t.sessionDetailRedesign.taskEditor.scope} content={sections.scope} />
      )}
      {sections.inputs && (
        <TaskSection title={t.sessionDetailRedesign.taskEditor.inputs} content={sections.inputs} />
      )}
      {sections.outputs && (
        <TaskSection title={t.sessionDetailRedesign.taskEditor.outputs} content={sections.outputs} />
      )}
      {sections.definitionOfDone && (
        <TaskSection title={t.sessionDetailRedesign.taskEditor.definitionOfDone} content={sections.definitionOfDone} />
      )}
      {sections.remainingContent && (
        <div className="mt-2 pt-2 border-t border-default">
          <div className="text-xs text-secondary">
            <MarkdownViewer content={sections.remainingContent} className="text-xs" />
          </div>
        </div>
      )}
    </div>
  );
}

function TaskNoteCard({
  note,
  index,
  expanded,
  editing,
  selected,
  onToggleSelect,
  onToggleExpand,
  onEdit,
  onCancelEdit,
  onSave,
  onDelete,
  onStatusChange,
  onExecute,
}: TaskNoteCardProps) {
  const { t } = useTranslation();
  const status = note.metadata.taskStatus ?? "PENDING";
  const statusLabels = getStatusLabels(t);
  const statusInfo = statusLabels[status] ?? statusLabels.PENDING;

  const statusIcon = {
    PENDING: (
      <div className="w-5 h-5 rounded-md border-2 border-default shrink-0" />
    ),
    IN_PROGRESS: (
      <div className="w-5 h-5 rounded-md bg-attention flex items-center justify-center shrink-0 animate-pulse">
        <Zap className="w-3 h-3 text-on-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
      </div>
    ),
    COMPLETED: (
      <div className="w-5 h-5 rounded-md bg-success flex items-center justify-center shrink-0">
        <Check className="w-3 h-3 text-on-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}/>
      </div>
    ),
    FAILED: (
      <div className="w-5 h-5 rounded-md bg-danger flex items-center justify-center shrink-0">
        <X className="w-3 h-3 text-on-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
      </div>
    ),
  };

  return (
    <div className={`rounded-lg border transition-all ${statusInfo.bg}`}>
      {/* Header */}
      <div
        className="flex items-start gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-hover transition-colors"
        onClick={onToggleExpand}
      >
        {onToggleSelect && status === "PENDING" ? (
          <label
            className="shrink-0 cursor-pointer"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={!!selected}
              onChange={() => onToggleSelect()}
              className="sr-only peer"
            />
            <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
              selected
                ? "bg-accent border-accent"
                : "border-default hover:border-accent"
            }`}>
              {selected && (
                <Check className="w-3 h-3 text-on-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}/>
              )}
            </div>
          </label>
        ) : (
          statusIcon[status as keyof typeof statusIcon] ?? statusIcon.PENDING
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold text-secondary">
              #{index + 1}
            </span>
            <span className="text-sm font-medium text-primary truncate">
              {note.title}
            </span>
          </div>
          {!expanded && note.content && (
            <p className="text-xs text-secondary mt-0.5 line-clamp-1">
              {note.content.slice(0, 100)}
            </p>
          )}
          {/* Last updated */}
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[9px] text-secondary">
              {new Date(note.updatedAt).toLocaleTimeString()}
            </span>
            {note.metadata.assignedAgentIds &&
              note.metadata.assignedAgentIds.length > 0 && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-accent-subtle text-accent">
                  Agent: {note.metadata.assignedAgentIds.join(", ")}
                </span>
              )}
          </div>
        </div>
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            title={t.sessionDetailRedesign.taskEditor.deleteTask}
            className="p-0.5 rounded text-secondary hover:text-danger hover:bg-danger-subtle transition-colors shrink-0"
          >
            <X className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          </button>
        )}
        <ChevronDown className={`w-4 h-4 text-secondary transition-transform shrink-0 mt-0.5 ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-3 pb-3 border-t border-default">
          {editing ? (
            <TaskNoteEditor
              note={note}
              onSave={onSave}
              onCancel={onCancelEdit}
            />
          ) : (
            <>
              <div className="mt-2.5 space-y-2">
                <TaskContentRenderer content={note.content || ""} />
              </div>

              {/* Actions */}
              <div className="mt-3 border-t border-default pt-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                {/* Execute button for pending tasks */}
                {(status === "PENDING") && onExecute && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onExecute();
                    }}
                    className="text-[11px] font-medium px-2 py-1 rounded-md transition-colors bg-success text-on-accent hover:opacity-90"
                  >
                    {t.tasks.execute}
                  </button>
                )}
                {status === "IN_PROGRESS" && (
                  <span className="text-[11px] text-attention font-medium animate-pulse px-2 py-1 rounded-md bg-attention-subtle">
                    {t.common.running}...
                  </span>
                )}
                {status === "COMPLETED" && (
                  <span className="text-[11px] text-success font-medium flex items-center gap-1 px-2 py-1 rounded-md bg-success-subtle">
                    <Check className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                    {t.tasks.completed}
                  </span>
                )}

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit();
                  }}
                  className="text-[11px] font-medium px-2 py-1 rounded-md bg-subtle text-primary hover:bg-hover transition-colors"
                >
                  Edit
                </button>

                {/* Status dropdown */}
                <Select
                  value={status}
                  onChange={(e) => {
                    e.stopPropagation();
                    onStatusChange(e.target.value);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="min-w-29.5 text-[11px] px-2 py-1 rounded-md border border-default bg-surface text-primary"
                >
                  <option value="PENDING">{t.sessionDetailRedesign.taskEditor.statusPending}</option>
                  <option value="IN_PROGRESS">{t.sessionDetailRedesign.taskEditor.statusInProgress}</option>
                  <option value="COMPLETED">{t.sessionDetailRedesign.taskEditor.statusCompleted}</option>
                  <option value="FAILED">{t.sessionDetailRedesign.taskEditor.statusFailed}</option>
                </Select>

                {onDelete && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete();
                    }}
                    className="text-[11px] font-medium px-2 py-1 rounded-md text-danger hover:bg-danger-subtle transition-colors"
                  >
                    {t.common.delete}
                  </button>
                )}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Task Note Editor ──────────────────────────────────────────────────

function TaskNoteEditor({
  note,
  onSave,
  onCancel,
}: {
  note: NoteData;
  onSave: (update: { title?: string; content?: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Update local state when note changes from SSE (collaborative edit)
  useEffect(() => {
    // Only update if not currently being edited by user
    if (!saving) {
      setTitle(note.title);
      setContent(note.content);
    }
  }, [note.title, note.content, saving]);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await onSave({ title, content });
    } finally {
      setSaving(false);
    }
  }, [title, content, onSave]);

  // Debounced auto-save for content changes
  const handleContentChange = useCallback(
    (newContent: string) => {
      setContent(newContent);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        try {
          // Auto-save via API (don't close editor)
          const res = await desktopAwareFetch("/api/notes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              noteId: note.id,
              content: newContent,
              workspaceId: note.workspaceId,
              source: "user",
            }),
          });
          if (!res.ok) console.warn("Auto-save failed:", res.status);
        } catch (err) {
          console.warn("Auto-save error:", err);
        }
      }, 1500);
    },
    [note.id, note.workspaceId]
  );

  return (
    <div className="mt-2.5 space-y-2">
      <div>
        <label className="text-[10px] font-semibold text-secondary uppercase">
          Title
        </label>
        <input
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mt-0.5 w-full text-xs px-2 py-1.5 rounded-md border border-default bg-surface text-primary focus:ring-1 focus:ring-success outline-none"
        />
      </div>
      <div>
        <label className="text-[10px] font-semibold text-secondary uppercase">
          Content
        </label>
        <textarea
          value={content}
          onChange={(e) => handleContentChange(e.target.value)}
          rows={8}
          className="mt-0.5 w-full text-xs px-2 py-1.5 rounded-md border border-default bg-surface text-primary focus:ring-1 focus:ring-success outline-none resize-y font-mono"
          placeholder={t.sessionDetailRedesign.taskEditor.contentPlaceholder}
        />
        <div className="text-[9px] text-secondary mt-0.5">
          Auto-saves after 1.5s of inactivity
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-xs font-medium px-2.5 py-1 rounded-md bg-success text-on-accent hover:opacity-90 transition-colors disabled:opacity-50"
        >
          {saving ? t.common.loading : t.common.saveAndClose}
        </button>
        <button
          onClick={onCancel}
          className="text-xs font-medium px-2.5 py-1 rounded-md bg-subtle text-primary hover:bg-hover transition-colors"
        >
          {t.common.cancel}
        </button>
      </div>
    </div>
  );
}
