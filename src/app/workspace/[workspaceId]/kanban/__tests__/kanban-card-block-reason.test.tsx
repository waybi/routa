/** Card 7fbfba57: two-line block reason on Blocked-column cards. */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KanbanColumnInfo, TaskInfo } from "../../types";
import { KanbanCard } from "../kanban-card";

vi.mock("@dnd-kit/core", () => ({
  useDraggable: () => ({ attributes: {}, isDragging: false, listeners: {}, setNodeRef: vi.fn(), transform: null }),
}));

const boardColumns: KanbanColumnInfo[] = [
  { id: "dev", name: "Dev", position: 0, stage: "dev" },
  { id: "blocked", name: "Blocked", position: 1, stage: "blocked" },
];

const S1_WHY = "上线前有一项老检查没过，不是这张卡的问题";
const S1_ACT = "不用你管：AI 正在修这项检查，修好后这张卡自动上线。";
const S2_WHY = "改的代码和别人刚上线的改动冲突了";
const S2_ACT = "要你定：先撤掉别人的改动，还是等它合并完再上";

function task(id: string, overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    id,
    title: `Card ${id}`,
    objective: "OBJECTIVE-TEXT",
    status: "BLOCKED",
    boardId: "b",
    columnId: "blocked",
    position: 0,
    priority: "medium",
    labels: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    artifactSummary: { total: 0, byType: {} },
    ...overrides,
  };
}

function mockFetch(bodies: Record<string, string | "fail" | "reject">) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const id = decodeURIComponent(String(input).split("/").pop() ?? "");
    const body = bodies[id];
    if (body === "reject") throw new Error("down");
    if (body === "fail" || body === undefined) return new Response("{}", { status: 500 });
    return new Response(JSON.stringify({ task: { comments: [{ id: "c", body, createdAt: "2026-01-02T00:00:00.000Z" }] } }), { status: 200 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function card(t: TaskInfo) {
  return (
    <KanbanCard
      key={t.id}
      task={t}
      boardColumns={boardColumns}
      specialistLanguage="en"
      availableProviders={[]}
      specialists={[]}
      codebases={[]}
      allCodebaseIds={[]}
      worktreeCache={{}}
      onOpenDetail={vi.fn()}
      onDelete={vi.fn()}
      onPatchTask={vi.fn()}
      onRetryTrigger={vi.fn()}
      onRefresh={vi.fn()}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("C4 Blocked card shows the two lines above the objective", () => {
  it.each([
    ["s1", `阻塞原因：${S1_WHY}\n${S1_ACT}`, S1_WHY, S1_ACT],
    ["s2", `阻塞原因：${S2_WHY}\n${S2_ACT}`, S2_WHY, S2_ACT],
  ])("%s", async (id, body, headline, action) => {
    mockFetch({ [`c4-${id}`]: body });
    render(card(task(`c4-${id}`)));
    const block = await screen.findByTestId("kanban-card-block-reason");
    expect(block.getAttribute("title")).toBe(body);
    expect(block.children[0].textContent).toBe(headline);
    expect(block.children[0].className).toContain("font-semibold");
    expect(block.children[0].className).toContain("text-primary");
    expect(block.children[1].textContent).toBe(action);
    expect(block.children[1].className).toContain("text-secondary");
    for (const line of Array.from(block.children)) {
      for (const cls of ["line-clamp-2", "text-[11px]", "leading-[1.45]", "[overflow-wrap:anywhere]"]) expect(line.className).toContain(cls);
    }
    expect(block.className).toBe("");
    expect(block.innerHTML).not.toMatch(/text-danger|bg-danger|attention|bg-red-|#[0-9a-fA-F]{3,6}\b/u);
    const objective = screen.getByText("OBJECTIVE-TEXT");
    expect(block.compareDocumentPosition(objective) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Card " + `c4-${id}`)).toBeTruthy();
  });

  it("shows one line when the comment has no second line", async () => {
    mockFetch({ "c4-one": "阻塞原因：只有原因" });
    render(card(task("c4-one")));
    const block = await screen.findByTestId("kanban-card-block-reason");
    expect(block.children).toHaveLength(1);
  });

  it("no comments, a failed read, a rejected read and lastSyncError show no block and do not throw", async () => {
    const fetchMock = mockFetch({ "c4-empty": "   ", "c4-500": "fail", "c4-rej": "reject" });
    render(<>{card(task("c4-empty"))}{card(task("c4-500"))}{card(task("c4-rej"))}{card(task("c4-sync", { lastSyncError: "push rejected" }))}</>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByTestId("kanban-card-block-reason")).toBeNull();
    expect(screen.getAllByText("OBJECTIVE-TEXT")).toHaveLength(4);
  });

  it.each(["dev", "review", "done"])("column %s: no block, no request", async (columnId) => {
    const fetchMock = mockFetch({});
    render(card(task(`c4-${columnId}`, { columnId })));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByTestId("kanban-card-block-reason")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("C5 read side effects", () => {
  it("reads once per id+updatedAt, GET only, Blocked cards only", async () => {
    const fetchMock = mockFetch({ "c5-a": `阻塞原因：${S1_WHY}\n${S1_ACT}`, "c5-b": "阻塞原因：B", "c5-c": "阻塞原因：C" });
    const blocked = ["c5-a", "c5-b", "c5-c"].map((id) => task(id));
    const others = ["c5-x", "c5-y", "c5-z"].map((id) => task(id, { columnId: "dev" }));
    const { rerender } = render(<>{blocked.map(card)}{others.map(card)}</>);
    await screen.findAllByTestId("kanban-card-block-reason");
    rerender(<>{blocked.map(card)}{others.map(card)}</>);
    rerender(<>{blocked.map(card)}{others.map(card)}</>);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [url, init] of fetchMock.mock.calls as unknown as Array<[string, RequestInit | undefined]>) {
      expect(String(url)).toMatch(/\/api\/tasks\/c5-[abc]$/u);
      expect((init?.method ?? "GET").toUpperCase()).toBe("GET");
    }
    rerender(<>{[task("c5-a", { updatedAt: "2026-02-01T00:00:00.000Z" }), ...blocked.slice(1)].map(card)}{others.map(card)}</>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
  });
});
