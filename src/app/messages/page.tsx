"use client";

/**
 * Messages Page - Notification & PR Agent Execution History
 * 
 * Shows:
 * - All notifications with filtering
 * - PR Agent execution history from background tasks
 * - Webhook trigger logs
 */

import { useState, useEffect } from "react";
import { DesktopAppShell } from "@/client/components/desktop-app-shell";
import { SettingsPageHeader } from "@/client/components/settings-page-header";
import { useWorkspaces } from "@/client/hooks/use-workspaces";
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { useTranslation } from "@/i18n";


interface BackgroundTask {
  id: string;
  name: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  type: string;
  createdAt: string;
  completedAt?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

interface TriggerLog {
  id: string;
  configId: string;
  eventType: string;
  eventAction?: string;
  backgroundTaskId?: string;
  signatureValid: boolean;
  outcome: "triggered" | "skipped" | "error";
  errorMessage?: string;
  createdAt: string;
}

export default function MessagesPage() {
  const { t } = useTranslation();
  const { workspaces, loading: workspacesLoading, createWorkspace } = useWorkspaces();
  const [tab, setTab] = useState<"tasks" | "logs">("tasks");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [tasks, setTasks] = useState<BackgroundTask[]>([]);
  const [logs, setLogs] = useState<TriggerLog[]>([]);
  const [loading, setLoading] = useState(false);
  const effectiveWorkspaceId = selectedWorkspaceId || workspaces[0]?.id || "";

  useEffect(() => {
    if (!effectiveWorkspaceId) {
      return;
    }

    const fetchData = async () => {
      setLoading(true);
      try {
        const [tasksRes, logsRes] = await Promise.all([
          desktopAwareFetch(`/api/background-tasks?workspaceId=${encodeURIComponent(effectiveWorkspaceId)}&limit=50`),
          desktopAwareFetch("/api/webhooks/logs?limit=50"),
        ]);
        if (tasksRes.ok) setTasks((await tasksRes.json()).tasks ?? []);
        if (logsRes.ok) setLogs((await logsRes.json()).logs ?? []);
      } catch { /* ignore */ }
      setLoading(false);
    };
    fetchData();
  }, [effectiveWorkspaceId]);

  const formatTime = (ts: string) => new Date(ts).toLocaleString();

  const getStatusBadge = (status: BackgroundTask["status"]) => {
    const colors: Record<string, string> = {
      pending: "bg-attention-subtle text-attention",
      running: "bg-accent-subtle text-accent",
      completed: "bg-success-subtle text-success",
      failed: "bg-danger-subtle text-danger",
      cancelled: "bg-subtle text-secondary",
    };
    return <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${colors[status] ?? colors.pending}`}>{status}</span>;
  };

  const getOutcomeBadge = (outcome: TriggerLog["outcome"]) => {
    const colors: Record<string, string> = {
      triggered: "bg-success-subtle text-success",
      skipped: "bg-attention-subtle text-attention",
      error: "bg-danger-subtle text-danger",
    };
    return <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${colors[outcome] ?? ""}`}>{outcome}</span>;
  };

  const copy = t.pagesRedesign.messagesPage;
  const activeWorkspace = workspaces.find((workspace) => workspace.id === effectiveWorkspaceId);
  const tabClassName = (active: boolean) =>
    `px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${active ? "bg-accent-subtle text-accent" : "text-secondary hover:bg-hover hover:text-primary"}`;

  return (
    <DesktopAppShell
      workspaceId={effectiveWorkspaceId || null}
      workspaceTitle={activeWorkspace?.title}
      workspaceSwitcher={(
        <WorkspaceSwitcher
          workspaces={workspaces}
          activeWorkspaceId={effectiveWorkspaceId || null}
          activeWorkspaceTitle={activeWorkspace?.title}
          onSelect={setSelectedWorkspaceId}
          onCreate={async (title) => {
            const workspace = await createWorkspace(title);
            if (workspace?.id) {
              setSelectedWorkspaceId(workspace.id);
            }
          }}
          loading={workspacesLoading}
          compact
          desktop
        />
      )}
    >
      <div className="flex h-full min-h-0 flex-col bg-canvas text-primary" data-testid="messages-page">
        <SettingsPageHeader
          title={t.pagesRedesign.headers.messages.title}
          description={t.pagesRedesign.headers.messages.description}
        >
          <div className="flex gap-1">
            <button
              onClick={() => setTab("tasks")}
              className={tabClassName(tab === "tasks")}
            >
              {copy.tabTasks}
            </button>
            <button
              onClick={() => setTab("logs")}
              className={tabClassName(tab === "logs")}
            >
              {copy.tabLogs}
            </button>
          </div>
        </SettingsPageHeader>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="max-w-5xl mx-auto p-6">
            {loading ? (
              <div className="text-center py-12 text-secondary">{t.uiKit.loading}</div>
            ) : tab === "tasks" ? (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-primary mb-4">{copy.tasksTitle}</h2>
                {tasks.length === 0 ? (
                  <p className="text-sm text-secondary py-8 text-center">{copy.tasksEmpty}</p>
                ) : (
                  tasks.map((task) => (
                    <div key={task.id} className="p-4 bg-surface border border-default rounded-xl">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-primary">{task.name}</span>
                        {getStatusBadge(task.status)}
                      </div>
                      <div className="flex items-center gap-4 text-[11px] text-secondary">
                        <span>{copy.type.replace("{value}", task.type)}</span>
                        <span>{copy.created.replace("{value}", formatTime(task.createdAt))}</span>
                        {task.completedAt && <span>{copy.completed.replace("{value}", formatTime(task.completedAt))}</span>}
                      </div>
                      {task.error && <p className="mt-2 text-xs text-danger">{task.error}</p>}
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-primary mb-4">{copy.logsTitle}</h2>
                {logs.length === 0 ? (
                  <p className="text-sm text-secondary py-8 text-center">{copy.logsEmpty}</p>
                ) : (
                  logs.map((l) => (
                    <div key={l.id} className="p-4 bg-surface border border-default rounded-xl">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-primary">{l.eventType}{l.eventAction ? `:${l.eventAction}` : ""}</span>
                        {getOutcomeBadge(l.outcome)}
                      </div>
                      <div className="flex items-center gap-4 text-[11px] text-secondary">
                        <span>{copy.config.replace("{value}", l.configId.slice(0, 8))}</span>
                        <span>{copy.signature.replace("{value}", l.signatureValid ? "✓" : "✗")}</span>
                        <span>{formatTime(l.createdAt)}</span>
                      </div>
                      {l.errorMessage && <p className="mt-2 text-xs text-danger">{l.errorMessage}</p>}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </DesktopAppShell>
  );
}
