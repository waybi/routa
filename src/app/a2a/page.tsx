"use client";

/**
 * A2A Protocol Test Page - /a2a
 *
 * Interactive testing interface for the Agent-to-Agent (A2A) protocol.
 * - View agent card and capabilities
 * - Send messages to remote agents
 * - Monitor task status and responses
 * - Inspect A2A protocol events
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "@/i18n";
import { DesktopAppShell } from "@/client/components/desktop-app-shell";
import { SettingsPageHeader } from "@/client/components/settings-page-header";
import { desktopAwareFetch } from "@/client/utils/diagnostics";

// ── Types ──────────────────────────────────────────────────────────────────

interface AgentSkill {
  id: string;
  name: string;
  description: string;
  tags?: string[];
  examples?: string[];
}

interface AgentCard {
  name: string;
  description: string;
  version: string;
  url?: string;
  documentationUrl?: string;
  skills: AgentSkill[];
  capabilities?: { streaming?: boolean; pushNotifications?: boolean };
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
}

interface A2ATask {
  id: string;
  contextId?: string;
  status: {
    state: "submitted" | "working" | "completed" | "failed" | "canceled";
    message?: { parts: Array<{ text?: string }> };
    timestamp?: string;
  };
  history?: Array<{ role: string; parts: Array<{ text?: string }> }>;
  metadata?: { workspaceId?: string; userPrompt?: string };
}

// ── Constants ──────────────────────────────────────────────────────────────

const STATE_STYLES: Record<string, { label: string; dot: string; badge: string }> = {
  submitted: { label: "Submitted", dot: "bg-secondary", badge: "bg-subtle text-secondary" },
  working:   { label: "Working",   dot: "bg-attention animate-pulse", badge: "bg-attention-subtle text-attention" },
  completed: { label: "Completed", dot: "bg-success", badge: "bg-success-subtle text-success" },
  failed:    { label: "Failed",    dot: "bg-danger", badge: "bg-danger-subtle text-danger" },
  canceled:  { label: "Canceled",  dot: "bg-secondary", badge: "bg-subtle text-secondary" },
};

// ── Sub-components ─────────────────────────────────────────────────────────

function StatusBadge({ state }: { state: string }) {
  const s = STATE_STYLES[state] ?? STATE_STYLES.submitted;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${s.badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

function SkillCard({ skill }: { skill: AgentSkill }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-lg border border-default bg-surface p-4 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-mono text-xs text-secondary mb-0.5">{skill.id}</p>
          <h3 className="font-semibold text-primary text-sm">{skill.name}</h3>
          <p className="text-secondary text-xs mt-1 leading-relaxed">{skill.description}</p>
        </div>
      </div>
      {skill.tags && skill.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-3">
          {skill.tags.map((tag) => (
            <span key={tag} className="rounded-md bg-subtle px-2 py-0.5 text-xs text-secondary font-mono">
              {tag}
            </span>
          ))}
        </div>
      )}
      {skill.examples && skill.examples.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-accent hover:underline"
          >
            {expanded ? "Hide examples" : `${skill.examples.length} example${skill.examples.length > 1 ? "s" : ""}`}
          </button>
          {expanded && (
            <ul className="mt-2 space-y-1">
              {skill.examples.map((ex, i) => (
                <li key={i} className="text-xs text-secondary pl-3 border-l-2 border-accent italic">
                  {ex}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function TaskRow({ task, onSelect }: { task: A2ATask; onSelect: (t: A2ATask) => void }) {
  const prompt = task.metadata?.userPrompt ?? task.history?.[0]?.parts?.[0]?.text ?? "—";
  const ts = task.status.timestamp ? new Date(task.status.timestamp).toLocaleTimeString() : "";

  return (
    <button
      onClick={() => onSelect(task)}
      className="w-full text-left rounded-lg border border-default bg-surface px-4 py-3 hover:border-accent hover:shadow transition-all group"
    >
      <div className="flex items-center justify-between gap-2 min-w-0">
        <span className="font-mono text-[11px] text-secondary truncate">{task.id.slice(0, 8)}…</span>
        <div className="flex items-center gap-2 flex-shrink-0">
          {ts && <span className="text-[11px] text-secondary">{ts}</span>}
          <StatusBadge state={task.status.state} />
        </div>
      </div>
      <p className="mt-1 text-sm text-primary truncate group-hover:text-accent transition-colors">
        {prompt.length > 120 ? prompt.slice(0, 120) + "…" : prompt}
      </p>
    </button>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function A2APage() {
  const { t } = useTranslation();
  const [agentCard, setAgentCard] = useState<AgentCard | null>(null);
  const [tasks, setTasks] = useState<A2ATask[]>([]);
  const [selectedTask, setSelectedTask] = useState<A2ATask | null>(null);
  const [prompt, setPrompt] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [sendError, setSendError] = useState("");
  const [activeTab, setActiveTab] = useState<"tasks" | "card" | "skills">("tasks");
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch AgentCard ──
  useEffect(() => {
    fetch("/.well-known/agent-card.json")
      .then((r) => r.json())
      .then(setAgentCard)
      .catch(console.error);
  }, []);

  // ── Fetch Tasks ──
  const fetchTasks = useCallback(async () => {
    const authoritySessionId = sessionId.trim();
    if (!authoritySessionId) {
      setTasks([]);
      return;
    }
    setLoadingTasks(true);
    try {
      const r = await desktopAwareFetch("/api/a2a/tasks", {
        headers: { "A2A-Session-Id": authoritySessionId },
      });
      if (r.ok) {
        const data = await r.json();
        setTasks(Array.isArray(data.tasks) ? data.tasks : []);
      }
    } catch (err) {
      console.error("fetchTasks error", err);
    } finally {
      setLoadingTasks(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Auto-refresh every 5 seconds
  useEffect(() => {
    refreshRef.current = setInterval(fetchTasks, 5000);
    return () => {
      if (refreshRef.current) clearInterval(refreshRef.current);
    };
  }, [fetchTasks]);

  // ── Send Message ──
  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    setSending(true);
    setSendError("");
    try {
      const body = {
        jsonrpc: "2.0",
        id: Date.now(),
        method: "SendMessage",
        params: {
          message: {
            messageId: crypto.randomUUID(),
            role: "user",
            parts: [{ text: prompt.trim() }],
          },
          metadata: {},
        },
      };
      const r = await desktopAwareFetch("/api/a2a/rpc", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "A2A-Session-Id": sessionId.trim(),
        },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (data.error) {
        setSendError(data.error.message ?? "Failed to send message");
      } else {
        setPrompt("");
        // Refresh tasks immediately
        await fetchTasks();
        // Select the new task
        if (data.result?.task) {
          setSelectedTask(data.result.task);
          setActiveTab("tasks");
        }
      }
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSending(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <DesktopAppShell workspaceId={null}>
      <div className="flex h-full min-h-0 flex-col bg-canvas font-sans text-primary" data-testid="a2a-page">
        <SettingsPageHeader
          title={t.pagesRedesign.headers.a2a.title}
          description={t.pagesRedesign.headers.a2a.description}
          actions={(
            <>
              {agentCard?.name ? (
                <span className="text-xs font-medium text-primary">{agentCard.name}</span>
              ) : null}
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success-subtle px-2.5 py-1 text-xs font-medium text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                Live
              </span>
              {agentCard?.version && (
                <span className="text-xs text-secondary font-mono">v{agentCard.version}</span>
              )}
            </>
          )}
        />

        <div className="min-h-0 flex-1 overflow-auto">
          <div className="mx-auto max-w-6xl px-6 py-8 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
            {/* Left column */}
            <div className="space-y-6">
              {/* Send message */}
              <section className="rounded-xl border border-default bg-surface shadow-sm p-6">
                <h2 className="text-sm font-semibold text-secondary mb-4">
                  Send Message
                </h2>
                <form onSubmit={handleSend} className="space-y-3">
                  <input
                    type="text"
                    placeholder={t.a2aPage.sessionIdRequired}
                    value={sessionId}
                    onChange={(e) => setSessionId(e.target.value)}
                    className="w-full rounded-lg border border-default bg-subtle px-3 py-2 text-sm text-primary placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
                  />
                  <textarea
                    rows={3}
                    placeholder={t.a2aPage.describeWhatYouNeed}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSend(e as unknown as React.FormEvent);
                    }}
                    className="w-full rounded-lg border border-default bg-subtle px-3 py-2.5 text-sm text-primary placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent resize-none"
                  />
                  {sendError && (
                    <p className="text-xs text-danger">{sendError}</p>
                  )}
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-secondary">⌘↵ to send</p>
                    <button
                      type="submit"
                      disabled={sending || !prompt.trim() || !sessionId.trim()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-sm font-medium text-on-accent transition-colors"
                    >
                      {sending ? (
                        <>
                          <span className="h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
                          Sending…
                        </>
                      ) : "Send →"}
                    </button>
                  </div>
                </form>
              </section>

              {/* Tabs */}
              <div className="flex gap-1 rounded-lg bg-subtle p-1 w-fit">
                {(["tasks", "card", "skills"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                      activeTab === tab
                        ? "bg-surface text-primary shadow-sm"
                        : "text-secondary hover:text-primary"
                    }`}
                  >
                    {tab === "tasks" ? `Tasks${tasks.length > 0 ? ` (${tasks.length})` : ""}` : tab === "card" ? "Agent Card" : "Skills"}
                  </button>
                ))}
              </div>

              {/* Task list */}
              {activeTab === "tasks" && (
                <section>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-secondary">
                      {loadingTasks ? "Refreshing…" : `${tasks.length} task${tasks.length !== 1 ? "s" : ""}`}
                    </p>
                    <button
                      onClick={fetchTasks}
                      disabled={loadingTasks}
                      className="text-xs text-accent hover:underline disabled:opacity-50"
                    >
                      Refresh
                    </button>
                  </div>
                  {tasks.length === 0 && !loadingTasks ? (
                    <div className="rounded-xl border border-dashed border-default p-10 text-center">
                      <p className="text-sm text-secondary">No tasks yet. Send a message to create one.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {tasks.map((task) => (
                        <TaskRow key={task.id} task={task} onSelect={(t) => {
                          setSelectedTask(t);
                        }} />
                      ))}
                    </div>
                  )}
                </section>
              )}

              {/* Agent Card JSON */}
              {activeTab === "card" && (
                <section className="rounded-xl border border-default bg-surface p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold text-secondary">
                      /.well-known/agent-card.json
                    </span>
                    <a
                      href="/.well-known/agent-card.json"
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-accent hover:underline"
                    >
                      Open ↗
                    </a>
                  </div>
                  {agentCard ? (
                    <pre className="text-xs leading-relaxed text-secondary overflow-x-auto whitespace-pre-wrap break-words">
                      {JSON.stringify(agentCard, null, 2)}
                    </pre>
                  ) : (
                    <p className="text-sm text-secondary">Loading…</p>
                  )}
                </section>
              )}

              {/* Skills */}
              {activeTab === "skills" && (
                <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {agentCard?.skills.map((skill) => (
                    <SkillCard key={skill.id} skill={skill} />
                  ))}
                  {!agentCard && (
                    <p className="text-sm text-secondary col-span-2">Loading skills…</p>
                  )}
                </section>
              )}
            </div>

            {/* Right column – Task detail */}
            <aside className="space-y-4">
              {/* Capabilities summary */}
              {agentCard && (
                <div className="rounded-xl border border-default bg-surface p-4">
                  <h2 className="text-xs font-semibold text-secondary mb-3">
                    Capabilities
                  </h2>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-secondary">Streaming</span>
                      <span className={agentCard.capabilities?.streaming ? "text-success" : "text-secondary"}>
                        {agentCard.capabilities?.streaming ? "✓" : "✗"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-secondary">Push Notifications</span>
                      <span className={agentCard.capabilities?.pushNotifications ? "text-success" : "text-secondary"}>
                        {agentCard.capabilities?.pushNotifications ? "✓" : "✗"}
                      </span>
                    </div>
                    {agentCard.defaultInputModes && (
                      <div className="pt-2 border-t border-default">
                        <p className="text-xs text-secondary mb-1">Input modes</p>
                        <div className="flex flex-wrap gap-1">
                          {agentCard.defaultInputModes.map((m) => (
                            <span key={m} className="font-mono text-[11px] bg-subtle rounded px-1.5 py-0.5 text-secondary">
                              {m}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {agentCard.defaultOutputModes && (
                      <div className="pt-2 border-t border-default">
                        <p className="text-xs text-secondary mb-1">Output modes</p>
                        <div className="flex flex-wrap gap-1">
                          {agentCard.defaultOutputModes.map((m) => (
                            <span key={m} className="font-mono text-[11px] bg-subtle rounded px-1.5 py-0.5 text-secondary">
                              {m}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Task detail panel */}
              <div className="rounded-xl border border-default bg-surface p-4">
                <h2 className="text-xs font-semibold text-secondary mb-3">
                  Task Detail
                </h2>
                {selectedTask ? (
                  <div className="space-y-3 text-sm">
                    <div className="flex items-center justify-between">
                      <StatusBadge state={selectedTask.status.state} />
                      <button
                        onClick={() => setSelectedTask(null)}
                        className="text-xs text-secondary hover:text-primary"
                      >
                        ✕
                      </button>
                    </div>
                    <div>
                      <p className="text-xs text-secondary mb-0.5">Task ID</p>
                      <p className="font-mono text-xs text-secondary break-all">{selectedTask.id}</p>
                    </div>
                    {selectedTask.contextId && (
                      <div>
                        <p className="text-xs text-secondary mb-0.5">Context ID</p>
                        <p className="font-mono text-xs text-secondary break-all">{selectedTask.contextId}</p>
                      </div>
                    )}
                    {selectedTask.metadata?.workspaceId && (
                      <div>
                        <p className="text-xs text-secondary mb-0.5">Workspace</p>
                        <p className="font-mono text-xs text-secondary">{selectedTask.metadata.workspaceId}</p>
                      </div>
                    )}
                    {selectedTask.metadata?.userPrompt && (
                      <div>
                        <p className="text-xs text-secondary mb-0.5">Prompt</p>
                        <p className="text-xs text-primary leading-relaxed">{selectedTask.metadata.userPrompt}</p>
                      </div>
                    )}
                    {selectedTask.status.message && (
                      <div>
                        <p className="text-xs text-secondary mb-0.5">Status Message</p>
                        <p className="text-xs text-secondary leading-relaxed">
                          {selectedTask.status.message.parts.map((p) => p.text).join("")}
                        </p>
                      </div>
                    )}
                    {/* Raw JSON toggle */}
                    <details className="group">
                      <summary className="cursor-pointer text-xs text-accent hover:underline list-none">
                        Raw JSON
                      </summary>
                      <pre className="mt-2 text-[11px] leading-relaxed text-secondary overflow-x-auto whitespace-pre-wrap break-words">
                        {JSON.stringify(selectedTask, null, 2)}
                      </pre>
                    </details>
                  </div>
                ) : (
                  <p className="text-sm text-secondary">
                    Select a task to see details.
                  </p>
                )}
              </div>

              {/* Quick API reference */}
              <div className="rounded-xl border border-default bg-surface p-4">
                <h2 className="text-xs font-semibold text-secondary mb-3">
                  API Endpoints
                </h2>
                <ul className="space-y-1.5 text-xs font-mono">
                  {[
                    { method: "GET",  path: "/.well-known/agent-card.json" },
                    { method: "POST", path: "/api/a2a/rpc   SendMessage" },
                    { method: "POST", path: "/api/a2a/rpc   GetTask" },
                    { method: "POST", path: "/api/a2a/rpc   ListTasks" },
                    { method: "POST", path: "/api/a2a/rpc   CancelTask" },
                    { method: "GET",  path: "/api/a2a/tasks" },
                    { method: "GET",  path: "/api/a2a/tasks/[id]" },
                  ].map((ep, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className={`rounded px-1 py-0.5 text-[10px] font-semibold flex-shrink-0 ${
                        ep.method === "GET"
                          ? "bg-accent-subtle text-accent"
                          : "bg-attention-subtle text-attention"
                      }`}>
                        {ep.method}
                      </span>
                      <span className="text-secondary break-all">{ep.path}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </DesktopAppShell>
  );
}
