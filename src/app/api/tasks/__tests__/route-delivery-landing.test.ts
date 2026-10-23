import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTask, TaskStatus, type Task } from "@/core/models/task";
import { InMemoryArtifactStore } from "@/core/store/artifact-store";
import { __resetTaskDeliveryLandingCacheForTests } from "@/core/kanban/task-delivery-landing";
import { collectTaskAttentionItems } from "@/app/workspace/[workspaceId]/kanban/kanban-attention-rules";
import { resolveCardMergeState } from "@/app/workspace/[workspaceId]/kanban/kanban-card-status";
import type { TaskInfo } from "@/app/workspace/[workspaceId]/types";

// GET /api/tasks with the real landing probe on real git worktrees: a card
// whose commits were cherry-picked onto base must not show as "unmerged".

const taskStore = {
  listByWorkspace: vi.fn<(_: string) => Promise<Task[]>>(),
  listByAssignee: vi.fn<(_: string) => Promise<Task[]>>(),
  listByStatus: vi.fn<(_: string, __: TaskStatus) => Promise<Task[]>>(),
};

const system = {
  taskStore,
  artifactStore: new InMemoryArtifactStore(),
  kanbanBoardStore: { get: vi.fn() },
  codebaseStore: { listByWorkspace: vi.fn(), get: vi.fn(), getDefault: vi.fn(), findByRepoPath: vi.fn() },
  worktreeStore: { listByWorkspace: vi.fn(), get: vi.fn() },
};

vi.mock("@/core/routa-system", () => ({ getRoutaSystem: () => system }));
vi.mock("@/core/kanban/boards", () => ({ ensureDefaultBoard: vi.fn(async () => ({ id: "board-1" })) }));
vi.mock("@/core/kanban/kanban-event-broadcaster", () => ({ getKanbanEventBroadcaster: () => ({ notify: vi.fn() }) }));
vi.mock("@/core/kanban/column-transition", () => ({ emitColumnTransition: vi.fn() }));
vi.mock("@/core/kanban/workflow-orchestrator-singleton", () => ({ processKanbanColumnTransition: vi.fn() }));
vi.mock("@/core/kanban/github-issues", () => ({
  createGitHubIssue: vi.fn(),
  buildTaskGitHubIssueBody: vi.fn((objective: string) => objective),
  resolveGitHubRepo: vi.fn(() => undefined),
}));

import { GET } from "../route";

const tempDirs: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function commitFile(repo: string, file: string, message: string): string {
  fs.writeFileSync(path.join(repo, file), file);
  git(repo, "add", file);
  git(repo, "commit", "-q", "-m", message);
  return git(repo, "rev-parse", "HEAD");
}

/** Repo with main = root and a card worktree on issue/<id> holding `commits` commits. */
function cardWorktree(id: string, commits: number, pickOntoMain: boolean): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "routa-route-landing-"));
  tempDirs.push(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "user.name", "Test");
  git(repo, "config", "commit.gpgsign", "false");
  commitFile(repo, "base.txt", "root");
  const worktreePath = `${repo}-wt`;
  tempDirs.push(worktreePath);
  git(repo, "worktree", "add", "-q", "-b", `issue/${id}`, worktreePath);
  const shas = Array.from({ length: commits }, (_, i) => commitFile(worktreePath, `work-${i}.txt`, `work ${i}`));
  commitFile(repo, "unrelated.txt", "unrelated");
  if (pickOntoMain) git(repo, "cherry-pick", ...shas);
  return worktreePath;
}

function doneCard(id: string): Task {
  return createTask({
    id,
    title: id,
    objective: "o",
    workspaceId: "workspace-1",
    boardId: "board-1",
    columnId: "done",
    worktreeId: `wt-${id}`,
    status: TaskStatus.COMPLETED,
  });
}

describe("GET /api/tasks deliveryLanding with replayed commits (F4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetTaskDeliveryLandingCacheForTests();
    const worktrees = new Map([
      ["wt-landed", { id: "wt-landed", codebaseId: "cb", worktreePath: cardWorktree("landed", 2, true), branch: "issue/landed", baseBranch: "main" }],
      ["wt-open", { id: "wt-open", codebaseId: "cb", worktreePath: cardWorktree("open", 2, false), branch: "issue/open", baseBranch: "main" }],
    ]);
    taskStore.listByWorkspace.mockResolvedValue([doneCard("landed"), doneCard("open")]);
    taskStore.listByAssignee.mockResolvedValue([]);
    taskStore.listByStatus.mockResolvedValue([]);
    system.kanbanBoardStore.get.mockResolvedValue({ id: "board-1", columns: [] });
    system.codebaseStore.listByWorkspace.mockResolvedValue([]);
    system.codebaseStore.get.mockResolvedValue(undefined);
    system.codebaseStore.getDefault.mockResolvedValue(undefined);
    system.codebaseStore.findByRepoPath.mockResolvedValue(undefined);
    system.worktreeStore.listByWorkspace.mockResolvedValue([]);
    system.worktreeStore.get.mockImplementation(async (id: string) => worktrees.get(id));
  });

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reports cherry-picked cards as landed and keeps real unmerged cards, down to the attention rules", async () => {
    const response = await GET(new NextRequest("http://localhost/api/tasks?workspaceId=workspace-1"));
    const data = await response.json() as { tasks: TaskInfo[] };

    expect(response.status).toBe(200);
    const byId = new Map(data.tasks.map((task) => [task.id, task]));
    const landed = byId.get("landed");
    const open = byId.get("open");
    expect(landed?.deliveryLanding).toEqual({ landedOnBase: true, commitsSinceBase: 0, branch: "issue/landed", baseBranch: "main" });
    expect(open?.deliveryLanding).toEqual({ landedOnBase: false, commitsSinceBase: 2, branch: "issue/open", baseBranch: "main" });
    // C11: internal layer counts never reach the API.
    expect(Object.keys(landed?.deliveryLanding ?? {}).sort()).toEqual(["baseBranch", "branch", "commitsSinceBase", "landedOnBase"]);

    expect(resolveCardMergeState(landed!)).not.toBe("unmerged");
    expect(resolveCardMergeState(open!)).toBe("unmerged");
    const report = { excerpt: "ok", commit: "abc", hasLeftover: false, createdAt: new Date().toISOString() };
    const options = { hasMainPusher: true, now: Date.now() };
    expect(collectTaskAttentionItems({ ...landed!, completionReport: report } as TaskInfo, options)).toEqual([]);
    expect(collectTaskAttentionItems({ ...open!, completionReport: report } as TaskInfo, options))
      .toEqual([{ taskId: "open", kind: "unmerged", ahead: 2 }]);
  });
});
