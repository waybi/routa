import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { KanbanCardDetail } from "../kanban-card-detail";
import { resetDesktopAwareFetchToGlobalFetch } from "./test-utils";
import { createDetailTask, detailBoard } from "./kanban-detail-fixtures";

const { desktopAwareFetch } = vi.hoisted(() => ({
  desktopAwareFetch: vi.fn(),
}));

vi.mock("@/client/utils/diagnostics", async () => {
  const actual = await vi.importActual<typeof import("@/client/utils/diagnostics")>("@/client/utils/diagnostics");
  return {
    ...actual,
    desktopAwareFetch,
  };
});

vi.mock("@/client/components/repo-picker", () => ({
  RepoPicker: () => <div data-testid="repo-picker-mock" />,
  shortenRepoPath: (value: string) => value,
}));

vi.mock("../use-runtime-fitness-status", async () => {
  const { mockUseRuntimeFitnessStatus } = await import("./test-utils");
  return {
    useRuntimeFitnessStatus: mockUseRuntimeFitnessStatus,
  };
});

const board = detailBoard;
const createTask = createDetailTask;

beforeEach(() => {
  resetDesktopAwareFetchToGlobalFetch(desktopAwareFetch);
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe("KanbanCardDetail JIT context (history memory)", () => {
  it("loads JIT Context lazily from history-session retrieval", async () => {
    desktopAwareFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/harness/task-adaptive/history-summary")) {
        return new Response(JSON.stringify({
          historySummary: {
            overview: "Started from 1 linked transcript session and narrowed to 1 recovered session plus 1 candidate file.",
            seedSessionCount: 1,
            recoveredSessionCount: 1,
            matchedFileCount: 1,
            seedSessions: [],
          },
          featureId: "kanban-workflow",
          featureName: "Kanban Workflow",
          selectedFiles: ["src/app/page.tsx"],
          matchedFileDetails: [{
            filePath: "src/app/page.tsx",
            changes: 1,
            sessions: 1,
            updatedAt: "2026-04-21T02:03:00.000Z",
          }],
          matchedSessionIds: ["session-codex"],
          warnings: ["Prefer the API route before the UI shell."],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/api/harness/task-adaptive")) {
        return new Response(JSON.stringify({
          summary: "history summary",
          historySummary: {
            overview: "Started from 3 linked history sessions and narrowed to 2 recovered sessions plus 1 candidate file.",
            seedSessionCount: 3,
            recoveredSessionCount: 2,
            matchedFileCount: 1,
            seedSessions: [{
              provider: "codex",
              sessionId: "session-trigger",
              updatedAt: "2026-04-21T02:00:00.000Z",
              promptSnippet: "Trace the Kanban task-adaptive loading path first.",
              touchedFiles: ["src/app/page.tsx", "src/app/layout.tsx"],
              repeatedReadFiles: ["src/app/page.tsx"],
              toolNames: ["exec_command"],
              failedReadSignals: [],
            }],
          },
          warnings: ["Prefer the API route before the UI shell.", "Prefer the API route before the UI shell."],
          matchConfidence: "high",
          matchReasons: [
            "Started from 3 linked history sessions as retrieval seeds.",
            "Started from 3 linked history sessions as retrieval seeds.",
          ],
          selectedFiles: ["src/app/page.tsx"],
          matchedFileDetails: [{
            filePath: "src/app/page.tsx",
            changes: 1,
            sessions: 1,
            updatedAt: "2026-04-21T02:03:00.000Z",
          }],
          matchedSessionIds: ["session-trigger", "session-history"],
          failures: [{
            provider: "codex",
            sessionId: "session-history",
            message: "Operation not permitted",
            toolName: "exec_command",
            command: "sed -n '1,200p' src/app/page.tsx",
          }, {
            provider: "codex",
            sessionId: "session-history",
            message: "Operation not permitted",
            toolName: "exec_command",
            command: "sed -n '1,200p' src/app/page.tsx",
          }],
          repeatedReadFiles: ["src/app/page.tsx", "src/app/page.tsx"],
          sessions: [{
            provider: "codex",
            sessionId: "session-history",
            updatedAt: "2026-04-21T02:03:00.000Z",
            promptSnippet: "Investigate why page context could not be read.",
            matchedFiles: ["src/app/page.tsx"],
            matchedChangedFiles: ["src/app/page.tsx"],
            matchedReadFiles: ["src/app/page.tsx"],
            matchedWrittenFiles: [],
            repeatedReadFiles: ["src/app/page.tsx"],
            toolNames: ["exec_command"],
            failedReadSignals: [],
          }],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected desktopAwareFetch: ${url}`);
    });

    const onPatchTask = vi.fn(async () => createTask("task-jit", "Recover JIT context"));

    render(
      <KanbanCardDetail
        task={{
          ...createTask("task-jit", "Recover JIT context"),
          columnId: "backlog",
          assignedRole: "CRAFTER",
          contextSearchSpec: {
            query: "recover jit context",
            featureCandidates: ["kanban-workflow"],
            relatedFiles: ["src/app/page.tsx"],
          },
          triggerSessionId: "session-trigger",
          sessionIds: ["session-history"],
          laneSessions: [{
            sessionId: "session-lane",
            status: "completed",
            startedAt: "2025-01-01T00:00:00.000Z",
          }],
          codebaseIds: ["repo-a"],
        }}
        boardColumns={board.columns}
        availableProviders={[]}
        specialists={[]}
        specialistLanguage="en"
        codebases={[{
          id: "repo-a",
          workspaceId: "workspace-1",
          repoPath: "/tmp/repo-a",
          label: "Repo A",
          isDefault: true,
          sourceType: "local",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        }]}
        allCodebaseIds={["repo-a"]}
        worktreeCache={{}}
        sessions={[]}
        fullWidth
        onPatchTask={onPatchTask}
        onRetryTrigger={vi.fn()}
        onDelete={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(desktopAwareFetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "History Memory" }));
    fireEvent.click(screen.getByRole("button", { name: "Show History Memory" }));

    expect(await screen.findByText("Historical issues")).toBeTruthy();
    expect(screen.getByText("History Summary")).toBeTruthy();
    expect(screen.getAllByText("Seed sessions: 3").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Recovered sessions: 2").length).toBeGreaterThan(0);
    expect(screen.getByText("Investigate why page context could not be read.")).toBeTruthy();
    expect(screen.getByText("Match confidence")).toBeTruthy();
    expect(screen.getAllByText("High").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Started from 3 linked history sessions as retrieval seeds.")).toHaveLength(1);
    expect(screen.getAllByText("Operation not permitted")).toHaveLength(1);
    expect(screen.getAllByText("Prefer the API route before the UI shell.")).toHaveLength(1);
    expect(screen.getByText("Repeated read hotspots")).toBeTruthy();
    expect(screen.getAllByText("src/app/page.tsx").length).toBeGreaterThan(0);
    expect(screen.getByText("Changes: 1")).toBeTruthy();
    expect(screen.getByText("sessions: 1")).toBeTruthy();
    expect(screen.getByText("session-history")).toBeTruthy();
    expect(screen.getAllByText(/Matched files: src\/app\/page\.tsx/).length).toBeGreaterThan(0);

    expect(desktopAwareFetch).toHaveBeenCalledWith(
      "/api/harness/task-adaptive",
      expect.objectContaining({
        method: "POST",
        body: expect.any(String),
      }),
    );

    const requestBody = JSON.parse(String(desktopAwareFetch.mock.calls[0]?.[1]?.body));
    expect(requestBody.taskAdaptiveHarness).toEqual(expect.objectContaining({
      taskId: "task-jit",
      taskLabel: "Recover JIT context",
      query: "recover jit context",
      historySessionIds: ["session-trigger", "session-history", "session-lane"],
      taskType: "planning",
      locale: "en",
      role: "CRAFTER",
    }));
    await waitFor(() => {
      expect(onPatchTask).toHaveBeenCalledWith(
        "task-jit",
        expect.objectContaining({
          jitContextSnapshot: expect.objectContaining({
            summary: "history summary",
            recommendedContextSearchSpec: expect.objectContaining({
              query: "recover jit context",
              relatedFiles: ["src/app/page.tsx"],
            }),
          }),
        }),
      );
    });
  });

  it("opens a dedicated history analysis flow from JIT Context", async () => {
    desktopAwareFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/harness/task-adaptive/history-summary")) {
        return new Response(JSON.stringify({
          historySummary: {
            overview: "Started from 1 linked transcript session and narrowed to 1 recovered session plus 1 candidate file.",
            seedSessionCount: 1,
            recoveredSessionCount: 1,
            matchedFileCount: 1,
            seedSessions: [],
          },
          featureId: "kanban-workflow",
          featureName: "Kanban Workflow",
          selectedFiles: ["src/app/page.tsx"],
          matchedFileDetails: [{
            filePath: "src/app/page.tsx",
            changes: 1,
            sessions: 1,
            updatedAt: "2026-04-21T02:03:00.000Z",
          }],
          matchedSessionIds: ["session-codex"],
          warnings: ["Prefer the API route before the UI shell."],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/api/harness/task-adaptive")) {
        return new Response(JSON.stringify({
          summary: "history summary",
          historySummary: {
            overview: "Started from 3 linked history sessions and narrowed to 2 recovered sessions plus 1 candidate file.",
            seedSessionCount: 3,
            recoveredSessionCount: 2,
            matchedFileCount: 1,
            seedSessions: [{
              provider: "codex",
              sessionId: "session-trigger",
              updatedAt: "2026-04-21T02:00:00.000Z",
              promptSnippet: "Trace the Kanban task-adaptive loading path first.",
              touchedFiles: ["src/app/page.tsx"],
              repeatedReadFiles: [],
              toolNames: ["exec_command"],
              failedReadSignals: [],
            }],
          },
          warnings: ["Prefer the API route before the UI shell."],
          matchConfidence: "high",
          matchReasons: ["Started from 3 linked history sessions as retrieval seeds."],
          selectedFiles: ["src/app/page.tsx"],
          matchedFileDetails: [{
            filePath: "src/app/page.tsx",
            changes: 1,
            sessions: 1,
            updatedAt: "2026-04-21T02:03:00.000Z",
          }],
          matchedSessionIds: ["session-codex"],
          failures: [],
          repeatedReadFiles: [],
          sessions: [{
            provider: "codex",
            sessionId: "session-codex",
            updatedAt: "2026-04-21T02:03:00.000Z",
            promptSnippet: "Inspect the Kanban API route before touching the UI shell.",
            matchedFiles: ["src/app/page.tsx"],
            matchedChangedFiles: ["src/app/page.tsx"],
            matchedReadFiles: ["src/app/page.tsx"],
            matchedWrittenFiles: [],
            repeatedReadFiles: [],
            toolNames: ["exec_command"],
            failedReadSignals: [],
          }],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected desktopAwareFetch: ${url}`);
    });

    const targetWindow = {
      close: vi.fn(),
      location: { href: "about:blank" },
    } as unknown as Window;
    const openSpy = vi.spyOn(window, "open").mockReturnValue(targetWindow);
    const onOpenHistoryAnalysis = vi.fn(async () => {});

    render(
      <KanbanCardDetail
        task={{
          ...createTask("task-jit-analysis", "Recover JIT context"),
          columnId: "backlog",
          assignedRole: "CRAFTER",
          contextSearchSpec: {
            query: "recover jit context",
            featureCandidates: ["kanban-workflow"],
            relatedFiles: ["src/app/page.tsx"],
          },
          triggerSessionId: "session-trigger",
          sessionIds: ["session-history"],
          laneSessions: [{
            sessionId: "session-lane",
            status: "completed",
            startedAt: "2025-01-01T00:00:00.000Z",
          }],
          codebaseIds: ["repo-a"],
        }}
        boardColumns={board.columns}
        availableProviders={[]}
        specialists={[]}
        specialistLanguage="en"
        codebases={[{
          id: "repo-a",
          workspaceId: "workspace-1",
          repoPath: "/tmp/repo-a",
          label: "Repo A",
          isDefault: true,
          sourceType: "local",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        }]}
        allCodebaseIds={["repo-a"]}
        worktreeCache={{}}
        sessions={[]}
        fullWidth
        onPatchTask={vi.fn(async () => createTask("task-jit-analysis", "Recover JIT context"))}
        onRetryTrigger={vi.fn()}
        onDelete={vi.fn()}
        onRefresh={vi.fn()}
        onOpenJitContextHistoryAnalysis={onOpenHistoryAnalysis}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "History Memory" }));
    fireEvent.click(screen.getByRole("button", { name: "Show History Memory" }));
    await screen.findByText("History Summary");

    fireEvent.click(screen.getByRole("button", { name: "Open History Analysis" }));

    await waitFor(() => {
      expect(onOpenHistoryAnalysis).toHaveBeenCalledWith(
        expect.stringContaining("summarize_task_history_context"),
        targetWindow,
      );
    });
    const lastOpenHistoryAnalysisCall = onOpenHistoryAnalysis.mock.calls.at(-1) as [unknown, unknown] | undefined;
    expect(lastOpenHistoryAnalysisCall).toBeTruthy();
    if (!lastOpenHistoryAnalysisCall) {
      throw new Error("expected history analysis prompt");
    }
    const historyAnalysisPrompt = String(lastOpenHistoryAnalysisCall[0] ?? "");
    const historyTargetWindow = lastOpenHistoryAnalysisCall[1];
    expect(historyTargetWindow).toBe(targetWindow);
    expect(historyAnalysisPrompt).toContain("- Task ID: task-jit-analysis");
    expect(historyAnalysisPrompt).toContain("- Repo Path: /tmp/repo-a");
    expect(historyAnalysisPrompt).toContain("- Task Type: planning");
    expect(historyAnalysisPrompt).toContain("### Transcript Hints");
    expect(historyAnalysisPrompt).toContain("~/.codex/sessions/**/session-codex*.jsonl");
    expect(historyAnalysisPrompt).toContain("### Final Matched Codex Or Claude Sessions");
    expect(historyAnalysisPrompt).toContain("Inspect the Kanban API route before touching the UI shell.");
    expect(historyAnalysisPrompt).toContain("Call `save_history_memory_context`");
    expect(historyAnalysisPrompt).toContain("Save action:");
    expect(historyAnalysisPrompt).toContain("Use `taskId=task-jit-analysis` in the tool call.");
    expect(historyAnalysisPrompt).not.toContain("\"jitContextAnalysis\"");
    expect(historyAnalysisPrompt).not.toContain("Required JSON payload:");
    expect(historyAnalysisPrompt).not.toContain("```json");
    expect(historyAnalysisPrompt).not.toContain("Preloaded tool result:");
    expect(historyAnalysisPrompt).not.toContain("The system already executed `summarize_task_history_context` before this session started.");
    expect(openSpy).toHaveBeenCalledWith("about:blank", "_blank");
    expect(screen.getByText("History analysis opened in a new page.")).toBeTruthy();
    openSpy.mockRestore();
  });

  it("renders saved structured history analysis from the persisted task snapshot", () => {
    render(
      <KanbanCardDetail
        task={{
          ...createTask("task-jit-saved-analysis", "Recover JIT context"),
          columnId: "backlog",
          assignedRole: "CRAFTER",
          jitContextSnapshot: {
            generatedAt: "2026-04-21T08:00:00.000Z",
            summary: "Recovered history context for Kanban workflow.",
            matchConfidence: "high",
            matchReasons: ["Matched the kanban-workflow feature."],
            warnings: [],
            matchedFileDetails: [{
              filePath: "crates/routa-server/src/api/kanban.rs",
              changes: 1,
              sessions: 3,
              updatedAt: "2026-04-21T08:00:00.000Z",
            }],
            matchedSessionIds: ["session-codex"],
            failures: [],
            repeatedReadFiles: [],
            sessions: [],
            analysis: {
              updatedAt: "2026-04-21T09:00:00.000Z",
              summary: "Start from the Kanban API and blocked interval reconstruction before touching the dashboard.",
              topFiles: ["crates/routa-server/src/api/kanban.rs"],
              topSessions: [{
                sessionId: "session-codex",
                provider: "codex",
                reason: "This session covered the durable flow-event implementation.",
              }],
              reusablePrompts: ["Check Rust and TS flow-event parity first."],
              recommendedContextSearchSpec: {
                query: "kanban flow event persistence",
                featureCandidates: ["kanban-workflow"],
                relatedFiles: ["crates/routa-server/src/api/kanban.rs"],
              },
            },
          },
        }}
        boardColumns={board.columns}
        availableProviders={[]}
        specialists={[]}
        specialistLanguage="en"
        codebases={[]}
        allCodebaseIds={[]}
        worktreeCache={{}}
        sessions={[]}
        fullWidth
        onPatchTask={vi.fn(async () => createTask("task-jit-saved-analysis", "Recover JIT context"))}
        onRetryTrigger={vi.fn()}
        onDelete={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "History Memory" }));

    expect(screen.getByText("Saved History Memory")).toBeTruthy();
    expect(screen.getByText("Start from the Kanban API and blocked interval reconstruction before touching the dashboard.")).toBeTruthy();
    expect(screen.getByText("Top files")).toBeTruthy();
    expect(screen.getByText("Top sessions")).toBeTruthy();
    expect(screen.getByText("Reusable prompts")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hide History Memory" })).toBeTruthy();
  });

  it("keeps the selected history memory tab after the detail pane remounts", () => {
    const task = {
      ...createTask("task-jit-tab-persist", "Recover persisted history memory"),
      jitContextSnapshot: {
        generatedAt: "2026-04-22T08:00:00.000Z",
        summary: "Recovered history context for Kanban workflow.",
        matchConfidence: "high" as const,
        matchReasons: ["Matched the saved Kanban workflow memory."],
        warnings: [],
        matchedFileDetails: [],
        matchedSessionIds: [],
        failures: [],
        repeatedReadFiles: [],
        sessions: [],
        analysis: {
          updatedAt: "2026-04-22T09:00:00.000Z",
          summary: "Resume from the saved memory instead of re-reading the full backlog transcript.",
          topFiles: ["src/app/api/kanban/boards/route.ts"],
          topSessions: [{
            sessionId: "session-jit-tab-persist",
            provider: "codex",
            reason: "This session already narrowed the feature and file scope.",
          }],
          reusablePrompts: ["Start from the previously matched Kanban route before searching wider."],
        },
      },
    };

    const props = {
      task,
      boardColumns: board.columns,
      availableProviders: [],
      specialists: [],
      specialistLanguage: "en" as const,
      codebases: [],
      allCodebaseIds: [],
      worktreeCache: {},
      sessions: [],
      fullWidth: true,
      onPatchTask: vi.fn(async () => task),
      onRetryTrigger: vi.fn(),
      onDelete: vi.fn(),
      onRefresh: vi.fn(),
    };

    const firstRender = render(<KanbanCardDetail {...props} />);

    fireEvent.click(screen.getByRole("tab", { name: "History Memory" }));
    expect(screen.getByRole("tab", { name: "History Memory" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Saved History Memory")).toBeTruthy();

    firstRender.unmount();

    render(<KanbanCardDetail {...props} />);

    expect(screen.getByRole("tab", { name: "History Memory" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Saved History Memory")).toBeTruthy();
    expect(screen.queryByText("Review Feedback")).toBeNull();
  });

  it("does not load or show speculative history memory for a fresh backlog card before refinement confirms context", async () => {
    const onPatchTask = vi.fn(async () => createTask("task-backlog-unconfirmed", "Investigate feature memory"));

    render(
      <KanbanCardDetail
        task={{
          ...createTask("task-backlog-unconfirmed", "[Feature] Investigate feature memory", {
            columnId: "backlog",
            assignedRole: "CRAFTER",
            jitContextSnapshot: {
              generatedAt: "2026-04-22T08:00:00.000Z",
              summary: "Speculative feature-explorer history memory.",
              featureId: "feature-explorer",
              featureName: "Feature Explorer",
              matchConfidence: "high",
              matchReasons: ["Matched a speculative feature seed."],
              warnings: [],
              matchedFileDetails: [{
                filePath: "src/app/workspace/[workspaceId]/feature-explorer/feature-explorer-page-client.tsx",
                changes: 4,
                sessions: 3,
                updatedAt: "2026-04-22T08:00:00.000Z",
              }],
              matchedSessionIds: ["session-speculative"],
              failures: [],
              repeatedReadFiles: [],
              sessions: [],
              recommendedContextSearchSpec: {
                query: "feature explorer",
                featureCandidates: ["feature-explorer"],
                relatedFiles: ["src/app/workspace/[workspaceId]/feature-explorer/feature-explorer-page-client.tsx"],
              },
            },
          }),
        }}
        boardColumns={board.columns}
        availableProviders={[]}
        specialists={[]}
        specialistLanguage="en"
        codebases={[]}
        allCodebaseIds={[]}
        worktreeCache={{}}
        sessions={[]}
        fullWidth
        onPatchTask={onPatchTask}
        onRetryTrigger={vi.fn()}
        onDelete={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "History Memory" }));
    fireEvent.click(screen.getByRole("button", { name: "Show History Memory" }));

    expect(screen.getByText("History memory becomes available after backlog refinement confirms feature or file hints for this card.")).toBeTruthy();
    expect(screen.queryByText("Speculative feature-explorer history memory.")).toBeNull();
    expect(screen.queryByText("Feature Explorer")).toBeNull();
    expect(desktopAwareFetch).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(onPatchTask).toHaveBeenCalledWith("task-backlog-unconfirmed", {
        jitContextSnapshot: null,
      });
    });
  });

  it("loads JIT Context from search hints even when no history sessions are linked", async () => {
    desktopAwareFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input);
      if (url === "/api/harness/task-adaptive") {
        return new Response(JSON.stringify({
          summary: "Recovered relevant files from feature search hints.",
          warnings: [],
          featureId: "kanban-workflow",
          featureName: "Kanban Workflow",
          selectedFiles: [
            "src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx",
            "src/app/api/tasks/route.ts",
          ],
          matchedFileDetails: [
            {
              filePath: "src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx",
              changes: 0,
              sessions: 0,
              updatedAt: "",
            },
            {
              filePath: "src/app/api/tasks/route.ts",
              changes: 0,
              sessions: 0,
              updatedAt: "",
            },
          ],
          matchedSessionIds: [],
          failures: [],
          repeatedReadFiles: [],
          sessions: [],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      throw new Error(`Unexpected desktopAwareFetch: ${url}`);
    });

    const onPatchTask = vi.fn(async () => createTask("task-jit-hints", "Recover JIT context"));

    render(
      <KanbanCardDetail
        task={{
          ...createTask("task-jit-hints", "Recover JIT context"),
          assignedRole: "CRAFTER",
          codebaseIds: ["repo-a"],
          contextSearchSpec: {
            query: "kanban card detail jit context",
            routeCandidates: ["/workspace/:workspaceId/kanban"],
            apiCandidates: ["POST /api/tasks"],
            moduleHints: ["kanban-card-detail"],
          },
        }}
        boardColumns={board.columns}
        availableProviders={[]}
        specialists={[]}
        specialistLanguage="en"
        codebases={[{
          id: "repo-a",
          workspaceId: "workspace-1",
          repoPath: "/tmp/repo-a",
          label: "Repo A",
          isDefault: true,
          sourceType: "local",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        }]}
        allCodebaseIds={["repo-a"]}
        worktreeCache={{}}
        sessions={[]}
        fullWidth
        onPatchTask={onPatchTask}
        onRetryTrigger={vi.fn()}
        onDelete={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "History Memory" }));
    fireEvent.click(screen.getByRole("button", { name: "Show History Memory" }));

    await waitFor(() => {
      expect(onPatchTask).toHaveBeenCalledWith(
        "task-jit-hints",
        expect.objectContaining({
          jitContextSnapshot: expect.objectContaining({
            featureId: "kanban-workflow",
            featureName: "Kanban Workflow",
            matchedFileDetails: expect.arrayContaining([
              expect.objectContaining({
                filePath: "src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx",
              }),
              expect.objectContaining({
                filePath: "src/app/api/tasks/route.ts",
              }),
            ]),
          }),
        }),
      );
    });

    const requestBody = JSON.parse(String(desktopAwareFetch.mock.calls[0]?.[1]?.body));
    expect(requestBody.taskAdaptiveHarness).toEqual(expect.objectContaining({
      taskId: "task-jit-hints",
      taskLabel: "Recover JIT context",
      query: "kanban card detail jit context",
      routeCandidates: ["/workspace/:workspaceId/kanban"],
      apiCandidates: ["POST /api/tasks"],
      moduleHints: ["kanban-card-detail"],
      taskType: "planning",
      locale: "en",
      role: "CRAFTER",
    }));
  });

  it("surfaces JIT Context warnings even when no sessions or files are recovered", async () => {
    desktopAwareFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input);
      if (url === "/api/harness/task-adaptive") {
        return new Response(JSON.stringify({
          summary: "No files recovered.",
          warnings: ["Feature not found: missing-feature", "No task-adaptive files could be resolved from the current request."],
          selectedFiles: [],
          matchedFileDetails: [],
          matchedSessionIds: [],
          failures: [],
          repeatedReadFiles: [],
          sessions: [],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      throw new Error(`Unexpected desktopAwareFetch: ${url}`);
    });

    const onPatchTask = vi.fn(async () => createTask("task-jit-warnings", "Broken JIT context"));

    render(
      <KanbanCardDetail
        task={{
          ...createTask("task-jit-warnings", "Broken JIT context"),
          assignedRole: "CRAFTER",
          codebaseIds: ["repo-a"],
          contextSearchSpec: {
            featureCandidates: ["missing-feature"],
          },
        }}
        boardColumns={board.columns}
        availableProviders={[]}
        specialists={[]}
        specialistLanguage="en"
        codebases={[{
          id: "repo-a",
          workspaceId: "workspace-1",
          repoPath: "/tmp/repo-a",
          label: "Repo A",
          isDefault: true,
          sourceType: "local",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        }]}
        allCodebaseIds={["repo-a"]}
        worktreeCache={{}}
        sessions={[]}
        fullWidth
        onPatchTask={onPatchTask}
        onRetryTrigger={vi.fn()}
        onDelete={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "History Memory" }));
    fireEvent.click(screen.getByRole("button", { name: "Show History Memory" }));

    await waitFor(() => {
      expect(onPatchTask).toHaveBeenCalledWith(
        "task-jit-warnings",
        expect.objectContaining({
          jitContextSnapshot: expect.objectContaining({
            warnings: [
              "Feature not found: missing-feature",
              "No task-adaptive files could be resolved from the current request.",
            ],
          }),
        }),
      );
    });
  });

  it("resets JIT Context when the task context search spec changes on the same card", async () => {
    desktopAwareFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({
        summary: "First JIT result",
        warnings: [],
        featureId: "feature-a",
        featureName: "Feature A",
        selectedFiles: ["src/app/alpha.tsx"],
        matchedFileDetails: [{
          filePath: "src/app/alpha.tsx",
          changes: 1,
          sessions: 1,
          updatedAt: "2026-04-21T10:00:00.000Z",
        }],
        matchedSessionIds: [],
        failures: [],
        repeatedReadFiles: [],
        sessions: [],
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        summary: "Second JIT result",
        warnings: [],
        featureId: "feature-b",
        featureName: "Feature B",
        selectedFiles: ["src/app/beta.tsx"],
        matchedFileDetails: [{
          filePath: "src/app/beta.tsx",
          changes: 2,
          sessions: 1,
          updatedAt: "2026-04-21T11:00:00.000Z",
        }],
        matchedSessionIds: [],
        failures: [],
        repeatedReadFiles: [],
        sessions: [],
      })));

    const onPatchTask = vi.fn(async () => createTask("task-jit-refresh", "Refresh JIT context"));

    const baseProps = {
      boardColumns: board.columns,
      availableProviders: [],
      specialists: [],
      specialistLanguage: "en" as const,
      codebases: [{
        id: "repo-a",
        workspaceId: "workspace-1",
        repoPath: "/tmp/repo-a",
        label: "Repo A",
        isDefault: true,
        sourceType: "local" as const,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      }],
      allCodebaseIds: ["repo-a"],
      worktreeCache: {},
      sessions: [],
      fullWidth: true,
      onPatchTask,
      onRetryTrigger: vi.fn(),
      onDelete: vi.fn(),
      onRefresh: vi.fn(),
    };

    const { rerender } = render(
      <KanbanCardDetail
        {...baseProps}
        task={{
          ...createTask("task-jit-refresh", "Refresh JIT context"),
          assignedRole: "CRAFTER",
          codebaseIds: ["repo-a"],
          contextSearchSpec: {
            query: "first-query",
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "History Memory" }));
    fireEvent.click(screen.getByRole("button", { name: "Show History Memory" }));
    await waitFor(() => {
      expect(onPatchTask).toHaveBeenCalledWith(
        "task-jit-refresh",
        expect.objectContaining({
          jitContextSnapshot: expect.objectContaining({
            featureName: "Feature A",
          }),
        }),
      );
    });

    rerender(
      <KanbanCardDetail
        {...baseProps}
        task={{
          ...createTask("task-jit-refresh", "Refresh JIT context"),
          assignedRole: "CRAFTER",
          codebaseIds: ["repo-a"],
          contextSearchSpec: {
            query: "second-query",
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "History Memory" }));
    fireEvent.click(screen.getByRole("button", { name: "Show History Memory" }));
    await waitFor(() => {
      expect(onPatchTask).toHaveBeenCalledWith(
        "task-jit-refresh",
        expect.objectContaining({
          jitContextSnapshot: expect.objectContaining({
            featureName: "Feature B",
          }),
        }),
      );
    });

    const firstRequestBody = JSON.parse(String(desktopAwareFetch.mock.calls[0]?.[1]?.body));
    const secondRequestBody = JSON.parse(String(desktopAwareFetch.mock.calls[1]?.[1]?.body));
    expect(firstRequestBody.taskAdaptiveHarness.query).toBe("first-query");
    expect(secondRequestBody.taskAdaptiveHarness.query).toBe("second-query");
    expect(screen.queryByText("Feature A")).toBeNull();
  });
});
