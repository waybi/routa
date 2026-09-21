import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KanbanHumanReadablePanel } from "../kanban-human-readable-panel";
import type { TaskInfo } from "../../types";
import type { TaskHumanSummaryRecord } from "@/core/kanban/task-human-summary";

const { desktopAwareFetch } = vi.hoisted(() => ({
  desktopAwareFetch: vi.fn(),
}));

vi.mock("@/client/utils/diagnostics", async () => {
  const actual = await vi.importActual<typeof import("@/client/utils/diagnostics")>("@/client/utils/diagnostics");
  return { ...actual, desktopAwareFetch };
});

const DESCRIPTION = `Intro paragraph.

## Backlog refinement notes

\`\`\`yaml
story:
  version: 1
  language: en
  title: "Re-walk error paths after forwarding lands"
  problem_statement: "Scenarios 8 and 9 were captured before the fix."
  user_value: "Reviewers see the real current state."
  acceptance_criteria:
    - id: AC1
      text: "Scenario 8 message passes all five assertions."
      testable: true
    - id: AC2
      text: "Scenario 9 button count is zero."
      testable: false
  constraints_and_affected_areas:
    - "Read-only"
  dependencies_and_sequencing:
    independent_story_check: fail
    depends_on:
      - "5cea679a"
    unblock_condition: "Both upstream cards reach done."
  out_of_scope:
    - "No product code changes"
  invest:
    independent:
      status: fail
      reason: "Depends on two upstream cards."
    negotiable:
      status: pass
      reason: "ok"
    valuable:
      status: pass
      reason: "ok"
    estimable:
      status: pass
      reason: "ok"
    small:
      status: pass
      reason: "ok"
    testable:
      status: pass
      reason: "ok"
\`\`\`
`;

const task: TaskInfo = {
  id: "task-1",
  title: "fallback title",
  objective: DESCRIPTION,
  status: "PENDING",
  boardId: "board-1",
  columnId: "review",
  position: 0,
  createdAt: "2025-01-01T00:00:00.000Z",
};

const record: TaskHumanSummaryRecord = {
  taskId: "task-1",
  descriptionHash: "hash-current",
  language: "en",
  model: "test-model",
  generatedAt: "2026-09-21T10:00:00.000Z",
  summary: {
    what: "Re-check two error scenarios and replace the parent card's evidence.",
    where: "In review, waiting on upstream cards.",
    blockedNext: "Backlog stage refines once both upstream cards are done.",
    evidence: [{ label: "AC1 assertions", where: "acceptance_criteria AC1" }],
  },
  lintHits: [],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

beforeEach(() => {
  desktopAwareFetch.mockReset();
});

describe("KanbanHumanReadablePanel", () => {
  it("renders parsed facts immediately, before any summary request resolves", () => {
    desktopAwareFetch.mockImplementation(() => new Promise<Response>(() => {}));

    render(
      <KanbanHumanReadablePanel
        task={task}
        boardColumns={[{ id: "review", name: "Review", position: 3, stage: "review" }]}
        specialistLanguage="en"
      />,
    );

    expect(screen.getByText("Re-walk error paths after forwarding lands")).toBeTruthy();
    expect(screen.getByText("Scenarios 8 and 9 were captured before the fix.")).toBeTruthy();
    expect(screen.getByText("Current lane: Review")).toBeTruthy();
    expect(screen.getByText("Blocked")).toBeTruthy();
    expect(screen.getByText("Depends on two upstream cards.")).toBeTruthy();
    const table = screen.getByTestId("human-readable-ac-table");
    expect(table.textContent).toContain("AC1");
    expect(table.textContent).toContain("Scenario 9 button count is zero.");
    expect(table.textContent).toContain("not testable");
    expect(screen.getByText("Loading cache…")).toBeTruthy();
  });

  it("uses the cached record without a POST when the hash matches", async () => {
    desktopAwareFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url === "/api/tasks/task-1/human-summary?language=en" && (!init?.method || init.method === "GET")) {
        return jsonResponse({ taskId: "task-1", descriptionHash: "hash-current", language: "en", record, stale: false, cached: true });
      }
      throw new Error(`unexpected request ${init?.method ?? "GET"} ${url}`);
    });

    render(<KanbanHumanReadablePanel task={task} specialistLanguage="en" />);

    await waitFor(() => expect(screen.getByText(record.summary.what)).toBeTruthy());
    expect(screen.getByText(record.summary.blockedNext)).toBeTruthy();
    expect(screen.getByText("AC1 assertions")).toBeTruthy();
    expect(screen.queryByTestId("human-readable-stale-badge")).toBeNull();
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeTruthy();
    expect(desktopAwareFetch).toHaveBeenCalledTimes(1);
  });

  it("auto-generates once when there is no cached record", async () => {
    desktopAwareFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (init?.method === "POST") {
        expect(url).toBe("/api/tasks/task-1/human-summary");
        expect(JSON.parse(String(init.body))).toEqual({ language: "en", force: false });
        return jsonResponse({ taskId: "task-1", descriptionHash: "hash-current", language: "en", record, stale: false, cached: false });
      }
      return jsonResponse({ taskId: "task-1", descriptionHash: "hash-current", language: "en", record: null, stale: false, cached: false });
    });

    render(<KanbanHumanReadablePanel task={task} specialistLanguage="en" />);

    await waitFor(() => expect(screen.getByText(record.summary.what)).toBeTruthy());
    const posts = desktopAwareFetch.mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method === "POST");
    expect(posts).toHaveLength(1);
  });

  it("shows the stale badge when the description changed and regenerates with force on click", async () => {
    const fresh: TaskHumanSummaryRecord = { ...record, descriptionHash: "hash-new", summary: { ...record.summary, what: "Fresh summary." } };
    desktopAwareFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({ language: "en", force: true });
        return jsonResponse({ taskId: "task-1", descriptionHash: "hash-new", language: "en", record: fresh, stale: false, cached: false });
      }
      void input;
      return jsonResponse({ taskId: "task-1", descriptionHash: "hash-new", language: "en", record, stale: true, cached: true });
    });

    render(<KanbanHumanReadablePanel task={task} specialistLanguage="en" />);

    await waitFor(() => expect(screen.getByTestId("human-readable-stale-badge")).toBeTruthy());
    expect(screen.getByText(record.summary.what)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));

    await waitFor(() => expect(screen.getByText("Fresh summary.")).toBeTruthy());
    expect(screen.queryByTestId("human-readable-stale-badge")).toBeNull();
  });

  it("surfaces generation failures and keeps the parsed facts visible", async () => {
    desktopAwareFetch.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return jsonResponse({ error: "ANTHROPIC_API_KEY missing" }, 500);
      }
      return jsonResponse({ taskId: "task-1", descriptionHash: "h", language: "en", record: null, stale: false, cached: false });
    });

    render(<KanbanHumanReadablePanel task={task} specialistLanguage="en" />);

    await waitFor(() => expect(screen.getByText("Failed to generate summary: ANTHROPIC_API_KEY missing")).toBeTruthy());
    expect(screen.getByText("Re-walk error paths after forwarding lands")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Generate summary" })).toBeTruthy();
  });

  it("works for a legacy card with a plain description", async () => {
    desktopAwareFetch.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return jsonResponse({ taskId: "legacy", descriptionHash: "h", language: "en", record: { ...record, taskId: "legacy" }, stale: false, cached: false });
      }
      return jsonResponse({ taskId: "legacy", descriptionHash: "h", language: "en", record: null, stale: false, cached: false });
    });

    render(
      <KanbanHumanReadablePanel
        task={{ ...task, id: "legacy", title: "Legacy card", objective: "Just one sentence.", columnId: undefined }}
        specialistLanguage="en"
      />,
    );

    expect(screen.getByText("Legacy card")).toBeTruthy();
    expect(screen.getByText(/no structured story/)).toBeTruthy();
    expect(screen.queryByTestId("human-readable-ac-table")).toBeNull();
    await waitFor(() => expect(screen.getByText(record.summary.what)).toBeTruthy());
  });
});
