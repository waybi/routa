"use client";

/**
 * WorkflowPanel — Workflow YAML Visualization and Management UI.
 *
 * Features:
 * - List, create, edit, and delete workflow YAML definitions
 * - DAG (Directed Acyclic Graph) visualization of workflow steps
 * - Execute workflows by creating background tasks
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useWorkspaces } from "@/client/hooks/use-workspaces";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { Select } from "./select";
import { useTranslation } from "@/i18n";
import { PieChart, SquarePen, Trash2, X, Play } from "lucide-react";


// ─── Types ───────────────────────────────────────────────────────────────────

interface WorkflowStep {
  name: string;
  specialist: string;
  adapter?: string;
  input?: string;
  output_key?: string;
  parallel_group?: string;
  on_failure?: string;
  if?: string;
}

interface WorkflowTrigger {
  type: "manual" | "webhook" | "schedule";
  source?: string;
  event?: string;
  cron?: string;
}

interface Workflow {
  id: string;
  name: string;
  description?: string;
  version?: string;
  trigger?: WorkflowTrigger;
  steps: WorkflowStep[];
  yamlContent: string;
}

const DEFAULT_YAML = `name: "My Workflow"
description: "A new workflow"
version: "1.0"

trigger:
  type: manual

steps:
  - name: "Step 1"
    specialist: "developer"
    adapter: "claude-code-sdk"
    input: |
      Your task here
    output_key: "result"
`;

const sectionHeadCls =
  "text-[11px] font-semibold text-secondary";

// ─── DAG Visualization ───────────────────────────────────────────────────────

interface DagNode {
  id: string;
  label: string;
  specialist: string;
  parallelGroup?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DagEdge {
  fromId: string;
  toId: string;
}

function buildDag(steps: WorkflowStep[]): { nodes: DagNode[]; edges: DagEdge[] } {
  if (!steps.length) return { nodes: [], edges: [] };

  const NODE_W = 160;
  const NODE_H = 48;
  const HGAP = 40;
  const VGAP = 20;

  // Group steps by parallel_group; sequential steps get unique group
  const groups: { key: string; steps: WorkflowStep[] }[] = [];
  let seqCounter = 0;
  for (const step of steps) {
    const gKey = step.parallel_group ?? `__seq_${seqCounter++}`;
    const existing = groups.find((g) => g.key === gKey);
    if (existing) {
      existing.steps.push(step);
    } else {
      groups.push({ key: gKey, steps: [step] });
    }
  }

  const nodes: DagNode[] = [];
  const edges: DagEdge[] = [];

  let curX = 20;
  const groupXMids: number[] = [];

  for (const group of groups) {
    const colCount = group.steps.length;
    const colWidth = colCount * NODE_W + (colCount - 1) * VGAP;
    const startY = 20;

    group.steps.forEach((step, idx) => {
      const x = curX + idx * (NODE_W + VGAP);
      const y = startY;
      nodes.push({
        id: step.name,
        label: step.name,
        specialist: step.specialist,
        parallelGroup: step.parallel_group,
        x,
        y,
        width: NODE_W,
        height: NODE_H,
      });
    });

    groupXMids.push(curX + colWidth / 2);
    curX += colWidth + HGAP;
  }

  // Draw edges: last node of group[i] → first node of group[i+1]
  for (let i = 0; i < groups.length - 1; i++) {
    const fromGroup = groups[i];
    const toGroup = groups[i + 1];
    // Connect each node in fromGroup to each node in toGroup
    for (const fromStep of fromGroup.steps) {
      for (const toStep of toGroup.steps) {
        edges.push({ fromId: fromStep.name, toId: toStep.name });
      }
    }
  }

  return { nodes, edges };
}

interface WorkflowDagProps {
  steps: WorkflowStep[];
  onStepClick?: (step: WorkflowStep) => void;
}

function WorkflowDag({ steps, onStepClick }: WorkflowDagProps) {
  const { t } = useTranslation();
  const { nodes, edges } = buildDag(steps);

  if (!nodes.length) {
    return (
      <div className="flex items-center justify-center h-24 text-xs text-secondary">
        {t.workflows.noSteps}
      </div>
    );
  }

  const svgWidth = Math.max(...nodes.map((n) => n.x + n.width)) + 30;
  const svgHeight = Math.max(...nodes.map((n) => n.y + n.height)) + 30;

  // Generate deterministic color per specialist
  function nodeColor(specialist: string) {
    const palette = [
      { bg: "var(--accentbg)", border: "var(--accent)", text: "var(--accent)" }, // accent
      { bg: "var(--greenbg)", border: "var(--green)", text: "var(--green)" }, // green
      { bg: "var(--amberbg)", border: "var(--amber)", text: "var(--amber)" }, // amber
      { bg: "var(--soft)", border: "var(--muted)", text: "var(--ink)" }, // neutral
      { bg: "var(--redbg)", border: "var(--red)", text: "var(--red)" }, // red
    ];
    let hash = 0;
    for (let i = 0; i < specialist.length; i++) {
      hash = (hash * 31 + specialist.charCodeAt(i)) & 0xffff;
    }
    return palette[hash % palette.length];
  }

  return (
    <div className="overflow-x-auto">
      <svg
        width={svgWidth}
        height={svgHeight}
        className="block"
        aria-label="Workflow DAG visualization"
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted)" />
          </marker>
        </defs>

        {/* Edges */}
        {edges.map((edge, i) => {
          const from = nodes.find((n) => n.id === edge.fromId);
          const to = nodes.find((n) => n.id === edge.toId);
          if (!from || !to) return null;
          const x1 = from.x + from.width;
          const y1 = from.y + from.height / 2;
          const x2 = to.x;
          const y2 = to.y + to.height / 2;
          const mx = (x1 + x2) / 2;
          return (
            <path
              key={i}
              d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke="var(--muted)"
              strokeWidth="1.5"
              markerEnd="url(#arrow)"
            />
          );
        })}

        {/* Nodes */}
        {nodes.map((node) => {
          const step = steps.find((s) => s.name === node.id);
          const color = nodeColor(node.specialist);
          return (
            <g
              key={node.id}
              transform={`translate(${node.x}, ${node.y})`}
              onClick={() => step && onStepClick?.(step)}
              className={onStepClick ? "cursor-pointer" : ""}
              role={onStepClick ? "button" : undefined}
              aria-label={`Step: ${node.label}`}
            >
              <rect
                width={node.width}
                height={node.height}
                rx={6}
                ry={6}
                fill={color.bg}
                stroke={color.border}
                strokeWidth="1.5"
              />
              <text
                x={node.width / 2}
                y={20}
                textAnchor="middle"
                fontSize="11"
                fontWeight="600"
                fill={color.text}
                className="select-none"
              >
                {node.label.length > 18 ? node.label.slice(0, 17) + "…" : node.label}
              </text>
              <text
                x={node.width / 2}
                y={35}
                textAnchor="middle"
                fontSize="9"
                fill={color.text}
                opacity="0.8"
                className="select-none"
              >
                {node.specialist}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── Workflow Editor Modal ───────────────────────────────────────────────────

interface EditorModalProps {
  workflow: Workflow | null; // null = create new
  onClose: () => void;
  onSaved: () => void;
}

function EditorModal({ workflow, onClose, onSaved }: EditorModalProps) {
  const { t } = useTranslation();
  const isNew = !workflow;
  const [id, setId] = useState(isNew ? "" : workflow!.id);
  const [yamlContent, setYamlContent] = useState(isNew ? DEFAULT_YAML : workflow!.yamlContent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      let res: Response;
      if (isNew) {
        res = await desktopAwareFetch("/api/workflows", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: id.trim(), yamlContent }),
        });
      } else {
        res = await desktopAwareFetch(`/api/workflows/${encodeURIComponent(workflow!.id)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ yamlContent }),
        });
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? t.workflows.executionFailed);
        return;
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-surface rounded-xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col border border-default" style={{ maxHeight: "85vh" }}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-default shrink-0">
          <h3 className="text-sm font-semibold text-primary">
            {isNew ? t.workflows.newWorkflow : `${t.workflows.editLabel}${workflow!.name}`}
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-hover text-secondary hover:text-primary"
          >
            <X className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
          {isNew && (
            <div>
              <label htmlFor="workflow-id-input" className="block text-xs font-medium text-primary mb-1">
                Workflow ID
              </label>
              <input
                id="workflow-id-input"
                type="text"
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="e.g. my-workflow"
                className="w-full text-xs px-2 py-1.5 rounded-md border border-default bg-surface text-primary placeholder:text-secondary focus-visible:outline-2 focus-visible:outline-accent font-mono"
              />
              <p className="text-[10px] text-secondary mt-0.5">
                Used as the filename (letters, numbers, hyphens, underscores only)
              </p>
            </div>
          )}

          <div>
            <label htmlFor="workflow-yaml-input" className="block text-xs font-medium text-primary mb-1">
              YAML Content
            </label>
            <textarea
              id="workflow-yaml-input"
              ref={textareaRef}
              value={yamlContent}
              onChange={(e) => setYamlContent(e.target.value)}
              rows={20}
              spellCheck={false}
              className="w-full text-xs px-2 py-1.5 rounded-md border border-default bg-subtle text-primary focus-visible:outline-2 focus-visible:outline-accent font-mono resize-y"
              placeholder="Workflow YAML..."
            />
          </div>

          {error && (
            <p className="text-xs text-danger">{error}</p>
          )}
        </div>

        <div className="px-4 py-3 border-t border-default flex justify-end gap-2 shrink-0">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-default text-primary hover:bg-hover transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || (isNew && !id.trim())}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-accent text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? t.workflows.saving : t.common.save}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Execute Modal ───────────────────────────────────────────────────────────

interface ExecuteModalProps {
  workflow: Workflow;
  onClose: () => void;
}

function ExecuteModal({ workflow, onClose }: ExecuteModalProps) {
  const { t } = useTranslation();
  const workspacesHook = useWorkspaces();
  const [payload, setPayload] = useState("");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedWorkspaceId || workspacesHook.workspaces.length === 0) return;
    setSelectedWorkspaceId(workspacesHook.workspaces[0].id);
  }, [selectedWorkspaceId, workspacesHook.workspaces]);

  const handleExecute = async () => {
    if (!selectedWorkspaceId) {
      setError(t.workflows.selectWorkspaceFirst);
      return;
    }
    setExecuting(true);
    setError(null);
    setResult(null);
    try {
      const res = await desktopAwareFetch(`/api/workflows/${encodeURIComponent(workflow.id)}/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: selectedWorkspaceId,
          triggerPayload: payload,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? t.workflows.executionFailed);
        return;
      }
      const data = await res.json();
      setResult(`Workflow run started: ${data.workflowRunId ?? "unknown"} (${data.taskIds?.length ?? 0} tasks)`);
    } catch (err) {
      setError(String(err));
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-surface rounded-xl shadow-2xl w-full max-w-lg mx-4 flex flex-col border border-default">
        <div className="flex items-center justify-between px-4 py-3 border-b border-default">
          <h3 className="text-sm font-semibold text-primary">
            Run: {workflow.name}
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-hover text-secondary hover:text-primary"
          >
            <X className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          </button>
        </div>

        <div className="px-4 py-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-primary mb-1">
              Workspace
            </label>
            <Select
              value={selectedWorkspaceId}
              onChange={(e) => setSelectedWorkspaceId(e.target.value)}
              disabled={executing || workspacesHook.loading || workspacesHook.workspaces.length === 0}
              className="w-full text-xs px-2 py-1.5 rounded-md border border-default bg-subtle text-primary focus-visible:outline-2 focus-visible:outline-accent"
            >
              {workspacesHook.workspaces.length === 0 ? (
                <option value="">No active workspace</option>
              ) : (
                workspacesHook.workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.title}
                  </option>
                ))
              )}
            </Select>
          </div>

          <div>
            <label className="block text-xs font-medium text-primary mb-1">
              Trigger Payload (optional)
            </label>
            <textarea
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              rows={4}
              className="w-full text-xs px-2 py-1.5 rounded-md border border-default bg-subtle text-primary focus-visible:outline-2 focus-visible:outline-accent font-mono resize-none"
              placeholder="JSON payload or description for this workflow run..."
            />
          </div>

          {result && (
            <p className="text-xs text-success">{result}</p>
          )}
          {error && (
            <p className="text-xs text-danger">{error}</p>
          )}
        </div>

        <div className="px-4 py-3 border-t border-default flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-default text-primary hover:bg-hover transition-colors"
          >
            {result ? t.common.close : t.common.cancel}
          </button>
          {!result && (
            <button
              onClick={handleExecute}
              disabled={executing || workspacesHook.loading || !selectedWorkspaceId}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-success text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {executing ? t.common.running : `▶ ${t.workflows.run}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Workflow Card ────────────────────────────────────────────────────────────

interface WorkflowCardProps {
  workflow: Workflow;
  onEdit: (w: Workflow) => void;
  onDelete: (w: Workflow) => void;
  onRun: (w: Workflow) => void;
}

function WorkflowCard({ workflow, onEdit, onDelete, onRun }: WorkflowCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [deletePending, setDeletePending] = useState(false);

  const triggerType = workflow.trigger?.type ?? "manual";
  const triggerBadgeMap: Record<string, string> = {
    manual: t.workflows.manual,
    webhook: t.workflows.webhook,
    schedule: t.workflows.schedule,
  };
  const triggerBadge = triggerBadgeMap[triggerType] ?? triggerType;

  const triggerColors: Record<string, string> = {
    manual: "bg-subtle text-primary",
    webhook: "bg-accent-subtle text-accent",
    schedule: "bg-attention-subtle text-attention",
  };

  const handleDelete = async () => {
    if (!deletePending) {
      setDeletePending(true);
      return;
    }
    onDelete(workflow);
  };

  return (
    <div
      className="rounded-lg border border-default bg-surface overflow-hidden"
      data-testid={`workflow-card-${workflow.id}`}
    >
      {/* Header */}
      <div className="px-3 py-2.5 flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-primary truncate">
              {workflow.name}
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${triggerColors[triggerType] ?? triggerColors.manual}`}>
              {triggerBadge}
            </span>
            <span className="text-[10px] text-secondary">
              v{workflow.version ?? "1.0"} · {workflow.steps.length} step{workflow.steps.length !== 1 ? "s" : ""}
            </span>
          </div>
          {workflow.description && (
            <p className="text-xs text-secondary mt-0.5 truncate">
              {workflow.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onRun(workflow)}
            className="p-1.5 rounded-md text-success hover:bg-success-subtle transition-colors"
            title={t.workflows.runWorkflow}
            aria-label={`${t.workflows.runWorkflow} ${workflow.name}`}
          >
            <Play className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"/>
          </button>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="p-1.5 rounded-md text-secondary hover:bg-hover transition-colors"
            title={expanded ? t.workflows.collapse : t.workflows.showGraph}
            aria-label={expanded ? `${t.workflows.collapse} ${workflow.name}` : `${t.workflows.showGraph} ${workflow.name}`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d={expanded ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
            </svg>
          </button>
          <button
            onClick={() => onEdit(workflow)}
            className="p-1.5 rounded-md text-accent hover:bg-accent-subtle transition-colors"
            title={t.workflows.editWorkflow}
            aria-label={`${t.workflows.editWorkflow} ${workflow.name}`}
          >
            <SquarePen className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          </button>
          <button
            onClick={handleDelete}
            onBlur={() => setDeletePending(false)}
            className={`p-1.5 rounded-md transition-colors ${
              deletePending
                ? "text-on-accent bg-danger hover:opacity-90"
                : "text-danger hover:bg-danger-subtle"
            }`}
            title={deletePending ? t.workflows.deleteConfirm : t.workflows.deleteWorkflow}
            aria-label={deletePending ? `${t.workflows.deleteConfirm} ${workflow.name}` : `${t.workflows.deleteWorkflow} ${workflow.name}`}
          >
            <Trash2 className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          </button>
        </div>
      </div>

      {/* DAG Graph */}
      {expanded && (
        <div className="border-t border-default px-3 py-3 bg-subtle">
          <p className={`${sectionHeadCls} mb-2`}>Workflow Graph</p>
          <WorkflowDag
            steps={workflow.steps}
            onStepClick={() => {
              // Clicking a step opens the run modal for the workflow
              onRun(workflow);
            }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function WorkflowPanel() {
  const { t } = useTranslation();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editTarget, setEditTarget] = useState<Workflow | null | undefined>(undefined); // undefined = closed, null = new
  const [runTarget, setRunTarget] = useState<Workflow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchWorkflows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await desktopAwareFetch("/api/workflows");
      if (!res.ok) {
        setError(t.workflows.noWorkflows);
        return;
      }
      const data = await res.json();
      setWorkflows(data.workflows ?? []);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [t.workflows.noWorkflows]);

  useEffect(() => {
    fetchWorkflows();
  }, [fetchWorkflows]);

  const handleDelete = useCallback(
    async (workflow: Workflow) => {
      try {
        const res = await desktopAwareFetch(`/api/workflows/${encodeURIComponent(workflow.id)}`, { method: "DELETE" });
        if (res.ok) {
          await fetchWorkflows();
        }
      } catch (err) {
        console.error("Delete failed:", err);
      }
    },
    [fetchWorkflows]
  );

  return (
    <div className="px-4 py-4 space-y-4 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className={sectionHeadCls}>Workflows ({workflows.length})</p>
        <button
          onClick={() => setEditTarget(null)}
          className="px-2.5 py-1 text-xs font-medium rounded-md bg-accent text-on-accent hover:opacity-90 transition-colors"
          aria-label={t.workflows.createNew}
        >
          + {t.workflows.newWorkflow}
        </button>
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs text-danger">{error}</p>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 text-xs text-secondary">
          <PieChart className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"/>
          {t.workflows.loadingWorkflows}
        </div>
      )}

      {/* Workflow list */}
      {!loading && workflows.length === 0 && (
        <div className="text-center py-8 text-xs text-secondary">
          <p>{t.workflows.noWorkflows}</p>
          <p className="mt-1">{t.workflows.noWorkflowsHint}</p>
        </div>
      )}

      <div className="space-y-2">
        {workflows.map((wf) => (
          <WorkflowCard
            key={wf.id}
            workflow={wf}
            onEdit={(w) => setEditTarget(w)}
            onDelete={handleDelete}
            onRun={(w) => setRunTarget(w)}
          />
        ))}
      </div>

      {/* Editor modal */}
      {editTarget !== undefined && (
        <EditorModal
          workflow={editTarget}
          onClose={() => setEditTarget(undefined)}
          onSaved={fetchWorkflows}
        />
      )}

      {/* Execute modal */}
      {runTarget && (
        <ExecuteModal
          workflow={runTarget}
          onClose={() => setRunTarget(null)}
        />
      )}
    </div>
  );
}
