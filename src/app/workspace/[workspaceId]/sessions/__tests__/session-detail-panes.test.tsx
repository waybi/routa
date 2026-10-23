/**
 * Events and Evidence panes (card 7, AC4 / AC5): read only after their tab
 * opens, never invent rows, tell "not read", "read failed" and "read, empty"
 * apart, and share one traces request.
 */
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SessionDetailTabs } from "../[sessionId]/session-detail-tabs";
import {
  EVENT_FILES_SHOWN,
  SESSION_TRACE_LIMIT,
  collectChangedFiles,
  isTraceListTruncated,
  summarizeEventFiles,
  useSessionTraces,
  type SessionTrace,
} from "../[sessionId]/use-session-traces";

const { mockFetch, artifactsProbe } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  artifactsProbe: vi.fn(),
}));

vi.mock("@/client/utils/diagnostics", () => ({ desktopAwareFetch: mockFetch }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock("../../kanban/kanban-card-artifacts", () => ({
  KanbanCardArtifacts: (props: { taskId: string; compact?: boolean }) => {
    artifactsProbe(props);
    return <div data-testid="artifacts-probe">{props.taskId}</div>;
  },
}));

const EVENT_TYPES = ["user_message", "agent_message", "agent_thought", "tool_call", "tool_result", "session_start", "session_end"] as const;
const EN_TYPE_LABELS = ["User message", "Assistant reply", "Thinking", "Tool call", "Tool result", "Session start", "Session end"];

function trace(index: number, extra: Partial<SessionTrace> = {}): SessionTrace {
  return {
    id: `t-${index}`,
    timestamp: new Date(Date.UTC(2026, 9, 23, 10, 0, index)).toISOString(),
    eventType: EVENT_TYPES[index % EVENT_TYPES.length],
    ...extra,
  };
}

function json(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

type Responder = (url: string) => Response | Promise<Response>;
function respond(responder: Responder) {
  mockFetch.mockImplementation(async (input: RequestInfo | URL) => responder(String(input)));
}
function calls(prefix: string) {
  return mockFetch.mock.calls.filter(([input]) => String(input).startsWith(prefix));
}

const eventsPane = () => within(screen.getByTestId("session-events-pane"));
const evidencePane = () => within(screen.getByTestId("session-evidence-pane"));

function renderTabs(props: Partial<React.ComponentProps<typeof SessionDetailTabs>> = {}) {
  return render(
    <SessionDetailTabs sessionId="session-1" workspaceId="ws-1" chat={<div data-testid="chat" />} {...props} />,
  );
}

beforeEach(() => {
  mockFetch.mockReset();
  artifactsProbe.mockReset();
});

describe("Events tab", () => {
  it("sends no request until the tab opens, then lists every record with names, tools and files", async () => {
    const records = EVENT_TYPES.map((_, index) => trace(index));
    records[3] = trace(3, {
      tool: { name: "edit", status: "completed" },
      files: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"].map((path) => ({ path, operation: "write" })),
    });
    respond((url) => (url.startsWith("/api/traces") ? json({ traces: records }) : json({})));
    renderTabs();
    expect(calls("/api/traces")).toHaveLength(0);
    expect(calls("/api/sessions")).toHaveLength(0);

    fireEvent.click(screen.getByRole("tab", { name: "Events" }));
    const rows = await screen.findAllByTestId("session-event-row");
    expect(calls("/api/traces")).toHaveLength(1);
    expect(String(calls("/api/traces")[0][0])).toBe("/api/traces?sessionId=session-1&limit=200");
    expect(rows).toHaveLength(records.length);
    EN_TYPE_LABELS.forEach((label, index) => expect(rows[index].textContent).toContain(label));
    expect(rows[3].textContent).toContain("edit");
    expect(rows[3].querySelectorAll('[data-testid="session-event-file"]')).toHaveLength(3);
    expect(rows[3].querySelector('[data-testid="session-event-more-files"]')?.textContent).toBe("2 more");
    expect(rows[0].querySelector("time")?.getAttribute("title")).toBeTruthy();
    expect(screen.queryByTestId("session-events-truncated")).toBeNull();
    expect(screen.getByTestId("session-events-open-traces").getAttribute("href")).toBe("/traces?workspaceId=ws-1");
  });

  it("shows the empty state and no rows when the session has no traces", async () => {
    respond(() => json({ traces: [] }));
    renderTabs();
    fireEvent.click(screen.getByRole("tab", { name: "Events" }));
    const empty = await eventsPane().findByTestId("ui-empty-state");
    expect(empty.textContent).toContain("This session has no trace records");
    expect(screen.queryAllByTestId("session-event-row")).toHaveLength(0);
  });

  it("shows ErrorState with a retry that reads again", async () => {
    let attempt = 0;
    respond((url) => {
      if (!url.startsWith("/api/traces")) return json({});
      attempt += 1;
      if (attempt === 1) return json({ message: "boom" }, false, 500);
      if (attempt === 2) return json({ traces: [trace(0), trace(1)] });
      return json({ message: "disk gone" }, false, 500);
    });
    renderTabs();
    fireEvent.click(screen.getByRole("tab", { name: "Events" }));
    const error = await eventsPane().findByTestId("ui-error-state");
    expect(error.textContent).toContain("Could not read events");
    expect(eventsPane().queryByTestId("ui-empty-state")).toBeNull();
    expect(screen.queryAllByTestId("session-event-row")).toHaveLength(0);

    fireEvent.click(eventsPane().getByRole("button", { name: "Read again" }));
    expect(await screen.findAllByTestId("session-event-row")).toHaveLength(2);
    expect(calls("/api/traces")).toHaveLength(2);
  });

  it("keeps the list it already has when a reload fails (hook level)", async () => {
    let attempt = 0;
    respond(() => {
      attempt += 1;
      return attempt === 1 ? json({ traces: [trace(0), trace(1)] }) : json({ message: "disk gone" }, false, 500);
    });
    const { result } = renderHook(() => useSessionTraces("session-1", true));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.traces).toHaveLength(2);
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("disk gone");
    expect(result.current.traces).toHaveLength(2);
  });

  it("stays idle and sends nothing while disabled", () => {
    respond(() => json({ traces: [] }));
    const { result } = renderHook(() => useSessionTraces("session-1", false));
    expect(result.current.status).toBe("idle");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("says only the latest 200 are shown when the cap is hit", async () => {
    respond(() => json({ traces: Array.from({ length: SESSION_TRACE_LIMIT }, (_, i) => trace(i)) }));
    renderTabs();
    fireEvent.click(screen.getByRole("tab", { name: "Events" }));
    expect((await screen.findByTestId("session-events-truncated")).textContent).toBe("Showing only the latest 200 events");
  });

  it("reads the new session's traces after switching session", async () => {
    respond(() => json({ traces: [trace(0)] }));
    const view = renderTabs();
    fireEvent.click(screen.getByRole("tab", { name: "Events" }));
    await screen.findAllByTestId("session-event-row");
    view.rerender(<SessionDetailTabs sessionId="session-2" workspaceId="ws-1" chat={<div data-testid="chat" />} />);
    await waitFor(() => expect(calls("/api/traces")).toHaveLength(2));
    expect(String(calls("/api/traces")[1][0])).toBe("/api/traces?sessionId=session-2&limit=200");
  });
});

describe("Evidence tab", () => {
  const card = { taskId: "25afcd82-1d6e-4551", taskTitle: "Fix login redirect", boardId: "board-9", columnId: "dev", relatedHandoffs: [] };

  it("reuses the sidebar's context: no context request, links to the card's changes, shows artifacts and de-duplicated files", async () => {
    respond((url) =>
      url.startsWith("/api/traces")
        ? json({ traces: [trace(0, { files: [{ path: "src/a.ts" }, { path: "src/b.ts" }] }), trace(1, { files: [{ path: "src/a.ts" }] })] })
        : json({}),
    );
    renderTabs({ knownContext: { sessionId: "session-1", kanbanContext: card } });
    expect(calls("/api/traces")).toHaveLength(0);
    fireEvent.click(screen.getByRole("tab", { name: "Evidence" }));
    await screen.findAllByTestId("session-evidence-file");
    expect(calls("/api/sessions")).toHaveLength(0);
    expect(screen.getByTestId("session-evidence-card").textContent).toContain("Fix login redirect");
    expect(screen.getByTestId("session-evidence-card").textContent).toContain("25afcd82");
    expect(screen.getByTestId("session-evidence-card-link").getAttribute("href")).toBe(
      "/workspace/ws-1/kanban?boardId=board-9&taskId=25afcd82-1d6e-4551&detailTab=changes",
    );
    expect(artifactsProbe).toHaveBeenCalledWith(expect.objectContaining({ taskId: "25afcd82-1d6e-4551", compact: true }));
    expect(screen.getAllByTestId("session-evidence-file").map((node) => node.textContent)).toEqual(["src/a.ts", "src/b.ts"]);
    fireEvent.click(screen.getByRole("tab", { name: "Events" }));
    expect(calls("/api/traces")).toHaveLength(1);
  });

  it("reads the context itself once, only after the tab opens, when the sidebar has not", async () => {
    respond((url) => (url.startsWith("/api/sessions/") ? json({ kanbanContext: card }) : json({ traces: [] })));
    renderTabs();
    expect(calls("/api/sessions/")).toHaveLength(0);
    fireEvent.click(screen.getByRole("tab", { name: "Evidence" }));
    await screen.findByTestId("session-evidence-card");
    expect(calls("/api/sessions/")).toHaveLength(1);
    expect(String(calls("/api/sessions/")[0][0])).toBe("/api/sessions/session-1/context");
    fireEvent.click(screen.getByRole("tab", { name: "Chat" }));
    fireEvent.click(screen.getByRole("tab", { name: "Evidence" }));
    expect(calls("/api/sessions/")).toHaveLength(1);
  });

  it("shows one empty state and no card block when there is neither a card nor changed files", async () => {
    respond((url) => (url.startsWith("/api/sessions/") ? json({ kanbanContext: null }) : json({ traces: [trace(0)] })));
    renderTabs();
    fireEvent.click(screen.getByRole("tab", { name: "Evidence" }));
    const empty = await evidencePane().findByTestId("ui-empty-state");
    expect(empty.textContent).toContain("This session is not linked to a card and has no recorded file changes.");
    expect(screen.queryByTestId("session-evidence-card")).toBeNull();
    expect(screen.queryByTestId("artifacts-probe")).toBeNull();
  });

  it("gives only the missing block its own empty note", async () => {
    respond((url) => (url.startsWith("/api/sessions/") ? json({ kanbanContext: card }) : json({ traces: [] })));
    renderTabs();
    fireEvent.click(screen.getByRole("tab", { name: "Evidence" }));
    expect(await screen.findByTestId("session-evidence-no-files")).toBeTruthy();
    expect(screen.getByTestId("session-evidence-card")).toBeTruthy();
    expect(evidencePane().queryByTestId("ui-empty-state")).toBeNull();
  });

  it("shows ErrorState with a retry when the context read fails", async () => {
    let attempt = 0;
    respond((url) => {
      if (!url.startsWith("/api/sessions/")) return json({ traces: [] });
      attempt += 1;
      return attempt === 1 ? json({}, false, 500) : json({ kanbanContext: card });
    });
    renderTabs();
    fireEvent.click(screen.getByRole("tab", { name: "Evidence" }));
    expect((await evidencePane().findByTestId("ui-error-state")).textContent).toContain("Could not read evidence");
    expect(evidencePane().queryByTestId("ui-empty-state")).toBeNull();
    fireEvent.click(evidencePane().getByRole("button", { name: "Read again" }));
    expect(await screen.findByTestId("session-evidence-card")).toBeTruthy();
    expect(calls("/api/sessions/")).toHaveLength(2);
  });
});

/** Deterministic PRNG so failures are reproducible. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("events / evidence pure logic against an independent judge (10,000 random lists)", () => {
  it("file summary, de-duplicated changed files and the 200 cap", () => {
    const rand = mulberry32(25_000_825);
    const pool = Array.from({ length: 12 }, (_, i) => `src/file-${i}.ts`);
    const mismatches: string[] = [];
    for (let run = 0; run < 10_000; run += 1) {
      const length = Math.floor(rand() * 251);
      const list: SessionTrace[] = Array.from({ length }, (_, i) => ({
        id: `r${run}-${i}`,
        timestamp: "2026-10-23T00:00:00.000Z",
        eventType: "tool_call",
        files: Array.from({ length: Math.floor(rand() * 9) }, () => ({ path: pool[Math.floor(rand() * pool.length)] })),
      }));
      // Judge: computed from the requirement, not from the implementation.
      const expectedUnique: string[] = [];
      for (const record of list) for (const file of record.files ?? []) if (!expectedUnique.includes(file.path)) expectedUnique.push(file.path);
      if (JSON.stringify(collectChangedFiles(list)) !== JSON.stringify(expectedUnique)) mismatches.push(`unique run ${run}`);
      if (isTraceListTruncated(list) !== (length >= 200)) mismatches.push(`truncated run ${run}`);
      for (const record of list.slice(0, 3)) {
        const count = record.files?.length ?? 0;
        const summary = summarizeEventFiles(record.files);
        if (summary.shown.length !== Math.min(3, count) || summary.more !== Math.max(0, count - 3)) {
          mismatches.push(`summary run ${run}`);
        }
      }
    }
    expect(EVENT_FILES_SHOWN).toBe(3);
    expect(mismatches.slice(0, 5)).toEqual([]);
  });
});
