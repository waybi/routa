/**
 * Redesigned card face (card 6972ad2e): status dot text + left border token
 * per run status, failure reason surviving a cleaned-up session, rerun on
 * failed cards, the unmerged-base badge, and the workspace / card-id row.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { KanbanColumnInfo, SessionInfo, TaskInfo } from "../../types";
import { KanbanCard, formatLaneActivityLine } from "../kanban-card";
import { KanbanDoneCard } from "../kanban-done-segments";
import { resolveCardLinkedSession } from "../kanban-session-activity";

vi.mock("@dnd-kit/core", () => ({
  useDraggable: () => ({ attributes: {}, isDragging: false, listeners: {}, setNodeRef: vi.fn(), transform: null }),
}));

const automatedDev: KanbanColumnInfo[] = [
  { id: "dev", name: "Dev", position: 0, stage: "dev", automation: { enabled: true, steps: [{ id: "s1", providerId: "codex", role: "CRAFTER" }] } },
  { id: "done", name: "Done", position: 1, stage: "done" },
];

function task(overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    id: "a1b2c3d4-0000-0000-0000-000000000000",
    title: "A long redesign card title that is allowed to wrap onto a second line without an ellipsis",
    objective: "objective",
    status: "IN_PROGRESS",
    boardId: "board-1",
    columnId: "dev",
    position: 0,
    labels: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as TaskInfo;
}

function session(overrides: Partial<SessionInfo>): SessionInfo {
  return { sessionId: "s1", cwd: "/tmp", workspaceId: "ws", createdAt: new Date().toISOString(), ...overrides } as SessionInfo;
}

function renderCard(props: { task: TaskInfo; linkedSession?: SessionInfo; onRetryTrigger?: (id: string) => Promise<void>; showWorkspace?: boolean; workspaceName?: string; retryPending?: boolean }) {
  return render(
    <KanbanCard
      task={props.task}
      boardColumns={automatedDev}
      linkedSession={props.linkedSession}
      specialistLanguage="en"
      availableProviders={[]}
      specialists={[]}
      codebases={[]}
      allCodebaseIds={[]}
      worktreeCache={{}}
      autoProviderId="codex"
      onOpenDetail={vi.fn()}
      onDelete={vi.fn()}
      onPatchTask={vi.fn()}
      onRetryTrigger={props.onRetryTrigger ?? vi.fn(async () => {})}
      onRefresh={vi.fn()}
      showWorkspace={props.showWorkspace}
      workspaceName={props.workspaceName}
      retryPending={props.retryPending}
    />,
  );
}

function cardRoot(): HTMLElement {
  return screen.getByTestId("kanban-card");
}

describe("AC2 status dot text and left border token", () => {
  it.each([
    {
      name: "working",
      linked: session({ acpStatus: "ready", lastActivityAt: new Date(Date.now() - 12_000).toISOString(), lastEventType: "tool_call", lastToolName: "Bash", lastToolStatus: "running" }),
      label: "Working",
      activity: "running Bash",
      border: "!border-l-success",
      tone: "success",
    },
    {
      name: "stalled",
      linked: session({ acpStatus: "ready", lastActivityAt: new Date(Date.now() - 5 * 60_000).toISOString(), lastEventType: "agent_message" }),
      label: "May be stuck",
      activity: "silent for 5 min",
      border: "!border-l-attention",
      tone: "attention",
    },
    {
      name: "failed",
      linked: session({ acpStatus: "error", acpError: "executor failed to start" }),
      label: "Failed",
      activity: "executor failed to start",
      border: "!border-l-danger",
      tone: "danger",
    },
    {
      name: "idle",
      linked: undefined,
      label: "Idle",
      activity: null,
      border: null,
      tone: "neutral",
    },
  ])("$name: shows '$label' and the matching border token", ({ name, linked, label, activity, border, tone }) => {
    renderCard({ task: task({ triggerSessionId: linked ? "s1" : undefined }), linkedSession: linked });
    const status = screen.getByTestId("kanban-card-run-status");
    expect(status.getAttribute("data-run-status")).toBe(name);
    expect(status.getAttribute("data-tone")).toBe(tone);
    expect(status.textContent).toContain(label);
    const dot = screen.getByTestId("kanban-card-status-dot");
    expect(dot.className).toContain(`bg-${tone === "neutral" ? "secondary" : tone}`);
    if (activity) expect(screen.getByTestId("kanban-card-activity").textContent).toContain(activity);
    const classes = cardRoot().className;
    if (border) {
      expect(classes).toContain("border-l-[3px]");
      expect(classes).toContain(border);
    } else {
      expect(classes).not.toMatch(/!border-l-(success|attention|danger)/);
    }
    expect(classes).toContain("focus-visible:outline-accent");
  });

  it("pulses only the working dot, and only outside reduced motion", () => {
    const working = session({ acpStatus: "ready", lastActivityAt: new Date().toISOString(), lastEventType: "agent_message" });
    const { unmount } = renderCard({ task: task({ triggerSessionId: "s1" }), linkedSession: working });
    expect(screen.getByTestId("kanban-card-status-dot").className).toContain("motion-safe:animate-pulse");
    unmount();
    renderCard({ task: task() });
    expect(screen.getByTestId("kanban-card-status-dot").className).not.toContain("animate-pulse");
  });

  it("first row: workspace chip in all-projects view and a mono 8-char card id; title is not truncated", () => {
    renderCard({ task: task(), showWorkspace: true, workspaceName: "local-tools" });
    expect(screen.getByTestId("kanban-card-workspace").textContent).toBe("local-tools");
    const id = screen.getByTestId("kanban-card-id");
    expect(id.textContent).toBe("a1b2c3d4");
    expect(id.className).toContain("font-mono");
    const title = screen.getByTestId("kanban-card-title");
    expect(title.className).not.toMatch(/truncate|line-clamp/);
  });

  it("hides the workspace chip on the single-board view", () => {
    renderCard({ task: task() });
    expect(screen.queryByTestId("kanban-card-workspace")).toBeNull();
  });

  it("falls back to 'specialist · age' from the newest lane run", () => {
    const now = Date.UTC(2026, 0, 1, 12);
    const line = formatLaneActivityLine(
      { laneSessions: [
        { sessionId: "old", status: "completed", startedAt: new Date(now - 5 * 3_600_000).toISOString(), specialistName: "Backlog Refiner" },
        { sessionId: "new", status: "completed", startedAt: new Date(now - 3_600_000).toISOString(), specialistName: "Dev Crafter" },
      ] } as Pick<TaskInfo, "laneSessions" | "updatedAt">,
      now,
      { laneActivity: "{who} · {age}", noActivity: "", ageJustNow: "just now", ageMinutes: "{count} min ago", ageHours: "{count} h ago", ageDays: "{count} d ago" },
    );
    expect(line).toBe("Dev Crafter · 1 h ago");
  });
});

describe("AC7 failure reason survives a cleaned-up run, rerun stays available", () => {
  it("shows the failure reason, not idle, after triggerSessionId was cleared", () => {
    const failedTask = task({
      triggerSessionId: undefined,
      laneSessions: [
        { sessionId: "gone", columnId: "dev", status: "failed", startedAt: "2026-01-01T00:00:00.000Z" },
      ],
    });
    const sessionMap = new Map<string, SessionInfo>([
      ["gone", session({ sessionId: "gone", acpStatus: "error", acpError: "watchdog: no output for 10 min" })],
    ]);
    const onRetryTrigger = vi.fn(async () => {});
    renderCard({ task: failedTask, linkedSession: resolveCardLinkedSession(failedTask, sessionMap), onRetryTrigger });

    expect(screen.getByTestId("kanban-card-run-status").getAttribute("data-run-status")).toBe("failed");
    expect(screen.getByTestId("kanban-card-activity").textContent).toContain("watchdog: no output for 10 min");
    expect(screen.queryByText("Idle")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Rerun" }));
    expect(onRetryTrigger).toHaveBeenCalledWith(failedTask.id);
  });
});

describe("rerun feedback on the card face (card 1e7dd356)", () => {
  const failedRun = { sessionId: "old-run", columnId: "dev", status: "failed" as const, startedAt: "2026-10-23T13:00:00.000Z" };
  const failedTask = () => task({ triggerSessionId: undefined, laneSessions: [failedRun] });
  const failedMap = () => new Map<string, SessionInfo>([
    ["old-run", session({ sessionId: "old-run", acpStatus: "error", acpError: "process exited" })],
  ]);

  it("turns the button into a disabled 'Starting…' at once and ignores repeat clicks", async () => {
    let finish: () => void = () => {};
    const onRetryTrigger = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    renderCard({ task: failedTask(), linkedSession: resolveCardLinkedSession(failedTask(), failedMap()), onRetryTrigger });

    const button = screen.getByTestId("kanban-card-run");
    fireEvent.click(button);
    fireEvent.click(button);

    expect(onRetryTrigger).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.textContent).toBe("Starting…");
    await act(async () => finish());
  });

  it("turns the button back on with its label when the request fails", async () => {
    let fail: (error: Error) => void = () => {};
    const onRetryTrigger = vi.fn(() => new Promise<void>((_resolve, reject) => { fail = reject; }));
    renderCard({ task: failedTask(), linkedSession: resolveCardLinkedSession(failedTask(), failedMap()), onRetryTrigger });

    fireEvent.click(screen.getByTestId("kanban-card-run"));
    await act(async () => fail(new Error("409 conflict")));

    const button = screen.getByTestId("kanban-card-run") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("Rerun");
    fireEvent.click(button);
    expect(onRetryTrigger).toHaveBeenCalledTimes(2);
  });

  it("queued rerun (no trigger session yet): shows starting, not the previous failure", () => {
    const pendingTask = failedTask();
    renderCard({
      task: pendingTask,
      linkedSession: resolveCardLinkedSession(pendingTask, failedMap(), { retryPending: true }),
      retryPending: true,
    });

    const status = screen.getByTestId("kanban-card-run-status");
    expect(status.getAttribute("data-run-status")).toBe("starting");
    expect(status.textContent).not.toContain("Failed");
    expect(screen.getByTestId("kanban-card-status-dot").className).not.toContain("bg-danger");
    expect(screen.queryByText(/process exited/)).toBeNull();
    const button = screen.getByTestId("kanban-card-run") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("Starting…");
  });

  it("started rerun not yet in the session list: shows starting; once listed, its real status", () => {
    const startedTask = task({
      triggerSessionId: "new-run",
      laneSessions: [failedRun, { sessionId: "new-run", columnId: "dev", status: "running", startedAt: "2026-10-23T13:20:00.000Z" }],
    });
    const { unmount } = renderCard({
      task: startedTask,
      linkedSession: resolveCardLinkedSession(startedTask, failedMap(), { retryPending: true }),
      retryPending: true,
    });
    expect(screen.getByTestId("kanban-card-run-status").getAttribute("data-run-status")).toBe("starting");
    unmount();

    const listed = new Map(failedMap()).set("new-run", session({ sessionId: "new-run", acpStatus: "error", acpError: "boom" }));
    renderCard({ task: startedTask, linkedSession: resolveCardLinkedSession(startedTask, listed) });
    expect(screen.getByTestId("kanban-card-run-status").getAttribute("data-run-status")).toBe("failed");
  });
});

describe("AC9 unmerged-base badge", () => {
  function renderDone(overrides: Partial<TaskInfo>) {
    return render(
      <KanbanDoneCard
        task={task({ columnId: "done", status: "COMPLETED", ...overrides })}
        segment="today"
        onOpenDetail={vi.fn()}
      />,
    );
  }

  it("shows the attention badge when commits are ahead of an unlanded base", () => {
    renderDone({ deliveryLanding: { landedOnBase: false, commitsSinceBase: 2 } });
    const badge = screen.getByTestId("kanban-done-card-unmerged");
    expect(badge.textContent).toBe("Not merged to base");
    expect(badge.querySelector("[data-tone]")?.getAttribute("data-tone")).toBe("attention");
  });

  it.each([
    ["merged", { deliveryLanding: { landedOnBase: true, commitsSinceBase: 0 } }],
    ["no new commits", { deliveryLanding: { landedOnBase: false, commitsSinceBase: 0 } }],
    ["unknown", {}],
  ])("does not render for %s", (_name, overrides) => {
    renderDone(overrides as Partial<TaskInfo>);
    expect(screen.queryByTestId("kanban-done-card-unmerged")).toBeNull();
  });
});
