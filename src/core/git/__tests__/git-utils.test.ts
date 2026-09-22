import { beforeEach, describe, expect, it, vi } from "vitest";

const { gitExecMock } = vi.hoisted(() => ({
  gitExecMock: vi.fn(),
}));

vi.mock("@/core/platform", () => ({
  getServerBridge: () => ({
    env: {
      currentDir: () => "/workspace",
    },
    fs: {
      existsSync: vi.fn(() => false),
      readDirSync: vi.fn(() => []),
    },
  }),
}));

vi.mock("@/core/utils/safe-exec", () => ({
  gitExec: gitExecMock,
}));

const {
  getRepoChanges,
  parseGitStatusPorcelain,
  isGitHubUrl,
  parseGitHubUrl,
  getRepoDeliveryStatus,
  getBranchStatus,
  listBranches,
  listRemoteBranches,
} = await import("../git-utils");

function formatGitArgs(args: string[]): string {
  return ["git", ...args].join(" ");
}

describe("parseGitStatusPorcelain", () => {
  beforeEach(() => {
    gitExecMock.mockReset();
  });

  it("preserves the first character of filenames in porcelain rows", () => {
    expect(parseGitStatusPorcelain(" M package-lock.json")).toEqual([
      { path: "package-lock.json", status: "modified" },
    ]);
  });

  it("parses untracked files without rewriting their path", () => {
    expect(parseGitStatusPorcelain("?? package-lock.json")).toEqual([
      { path: "package-lock.json", status: "untracked" },
    ]);
  });

  it("parses renamed, copied, conflicted, and ignored entries", () => {
    expect(
      parseGitStatusPorcelain(
        "R  src/old.ts -> src/new.ts\nC  src/base.ts -> src/copied.ts\nUU src/conflict.ts\n!! dist/out.js\n",
      ),
    ).toEqual([
      { path: "src/new.ts", previousPath: "src/old.ts", status: "renamed" },
      { path: "src/copied.ts", previousPath: "src/base.ts", status: "copied" },
      { path: "src/conflict.ts", status: "conflicted" },
    ]);
  });

  it("keeps the first file path intact when git status output starts with a leading space", () => {
    gitExecMock.mockImplementation((args: string[]) => {
      const command = formatGitArgs(args);
      if (command === "git rev-parse --abbrev-ref HEAD") return "main\n";
      if (command === "git status --porcelain -uall") return " M package-lock.json\n M package.json\n";
      if (command === "git rev-list --left-right --count HEAD...@{upstream}") {
        throw new Error("no upstream");
      }
      if (command === "git --no-pager diff --no-ext-diff --find-renames --find-copies --numstat") {
        return "";
      }
      if (command === "git --no-pager diff --no-ext-diff --find-renames --find-copies --cached --numstat") {
        return "";
      }
      if (command === "git --no-pager diff --no-ext-diff --find-renames --find-copies HEAD --numstat") {
        return "";
      }
      if (command === "git rev-parse --git-dir") return ".git\n";
      throw new Error(`Unexpected command: ${command}`);
    });

    expect(getRepoChanges("/tmp/repo").files.map((file) => file.path)).toEqual([
      "package-lock.json",
      "package.json",
    ]);
  });
});

describe("GitHub URL parsing", () => {
  it("detects GitHub URLs and owner/repo shorthand", () => {
    expect(isGitHubUrl("https://github.com/phodal/routa-js")).toBe(true);
    expect(isGitHubUrl("git@github.com:phodal/routa-js.git")).toBe(true);
    expect(isGitHubUrl("phodal/routa-js")).toBe(true);
    expect(isGitHubUrl("C:\\repos\\routa-js")).toBe(false);
  });

  it("parses multiple GitHub URL formats", () => {
    expect(parseGitHubUrl("https://github.com/phodal/routa-js.git")).toEqual({
      owner: "phodal",
      repo: "routa-js",
    });
    expect(parseGitHubUrl("git@github.com:phodal/routa-js.git")).toEqual({
      owner: "phodal",
      repo: "routa-js",
    });
    expect(parseGitHubUrl("phodal/routa-js")).toEqual({
      owner: "phodal",
      repo: "routa-js",
    });
    expect(parseGitHubUrl("/tmp/repo")).toBeNull();
  });
});

describe("delivery and branch status helpers", () => {
  beforeEach(() => {
    gitExecMock.mockReset();
  });

  it("computes delivery status for a clean GitHub-backed branch", () => {
    gitExecMock.mockImplementation((args: string[]) => {
      const command = formatGitArgs(args);
      if (command === "git rev-parse --abbrev-ref HEAD") return "feature/login\n";
      if (command === "git status --porcelain -uall") return "";
      if (command === "git rev-list --left-right --count HEAD...@{upstream}") return "2 0\n";
      if (command === "git remote get-url origin") return "https://github.com/phodal/routa-js.git\n";
      if (command === "git rev-parse --verify origin/main") return "abc123\n";
      if (command === "git rev-list --count origin/main..HEAD") return "3\n";
      if (command === "git rev-parse --git-dir") return ".git\n";
      if (command === "git rev-parse --is-bare-repository") return "false\n";
      if (command === "git merge-base --is-ancestor HEAD origin/main") throw new Error("exit 1");
      if (command === "git rev-parse --verify main") throw new Error("no local main");
      throw new Error(`Unexpected command: ${command}`);
    });

    expect(
      getRepoDeliveryStatus("/tmp/repo", {
        baseBranch: "main",
      }),
    ).toEqual(
      expect.objectContaining({
        branch: "feature/login",
        baseBranch: "main",
        baseRef: "origin/main",
        commitsSinceBase: 3,
        hasCommitsSinceBase: true,
        hasUncommittedChanges: false,
        isGitHubRepo: true,
        canCreatePullRequest: true,
        landedOnBase: false,
      }),
    );
  });

  describe("landedOnBase", () => {
    function mockDeliveryRepo(overrides: Record<string, string | Error>) {
      gitExecMock.mockImplementation((args: string[]) => {
        const command = formatGitArgs(args);
        if (command in overrides) {
          const value = overrides[command];
          if (value instanceof Error) throw value;
          return value;
        }
        if (command === "git rev-parse --abbrev-ref HEAD") return "issue/abc\n";
        if (command === "git status --porcelain -uall") return "";
        if (command === "git rev-list --left-right --count HEAD...@{upstream}") return "0 0\n";
        if (command === "git remote get-url origin") return "ssh://gerrit.example/repo\n";
        if (command === "git rev-parse --verify origin/feat/base") return "base-remote\n";
        if (command === "git rev-list --count origin/feat/base..HEAD") return "2\n";
        throw new Error(`Unexpected command: ${command}`);
      });
    }

    it("is true when HEAD is reachable from the resolved base ref", () => {
      mockDeliveryRepo({
        "git merge-base --is-ancestor HEAD origin/feat/base": "",
      });

      expect(getRepoDeliveryStatus("/tmp/repo", { baseBranch: "feat/base" }).landedOnBase).toBe(true);
      expect(gitExecMock).not.toHaveBeenCalledWith(
        ["merge-base", "--is-ancestor", "HEAD", "feat/base"],
        expect.anything(),
      );
    });

    it("falls back to the local base branch when the remote-tracking ref is behind", () => {
      mockDeliveryRepo({
        "git merge-base --is-ancestor HEAD origin/feat/base": new Error("exit 1"),
        "git rev-parse --verify feat/base": "base-local\n",
        "git merge-base --is-ancestor HEAD feat/base": "",
      });

      expect(getRepoDeliveryStatus("/tmp/repo", { baseBranch: "feat/base" }).landedOnBase).toBe(true);
    });

    it("is false when neither remote nor local base contains HEAD", () => {
      mockDeliveryRepo({
        "git merge-base --is-ancestor HEAD origin/feat/base": new Error("exit 1"),
        "git rev-parse --verify feat/base": "base-local\n",
        "git merge-base --is-ancestor HEAD feat/base": new Error("exit 1"),
      });

      expect(getRepoDeliveryStatus("/tmp/repo", { baseBranch: "feat/base" }).landedOnBase).toBe(false);
    });

    it("is null when no base ref can be resolved", () => {
      gitExecMock.mockImplementation((args: string[]) => {
        const command = formatGitArgs(args);
        if (command === "git rev-parse --abbrev-ref HEAD") return "detached\n";
        if (command === "git status --porcelain -uall") return "";
        if (command === "git rev-list --left-right --count HEAD...@{upstream}") throw new Error("no upstream");
        if (command === "git remote get-url origin") throw new Error("no remote");
        if (command.startsWith("git rev-parse --verify ")) throw new Error("missing");
        throw new Error(`Unexpected command: ${command}`);
      });

      const status = getRepoDeliveryStatus("/tmp/repo", { baseBranch: null });
      expect(status.baseRef).toBeUndefined();
      expect(status.landedOnBase).toBeNull();
      expect(gitExecMock).not.toHaveBeenCalledWith(
        expect.arrayContaining(["merge-base"]),
        expect.anything(),
      );
    });
  });

  it("computes branch ahead/behind status and uncommitted changes", () => {
    gitExecMock.mockImplementation((args: string[]) => {
      const command = formatGitArgs(args);
      if (command === "git rev-list --left-right --count feature/login...origin/feature/login") {
        return "4 1\n";
      }
      if (command === "git rev-parse --git-dir") return ".git\n";
      if (command === "git rev-parse --is-bare-repository") return "false\n";
      if (command === "git status --porcelain -uall") return " M src/app.ts\n";
      throw new Error(`Unexpected command: ${command}`);
    });

    expect(getBranchStatus("/tmp/repo", "feature/login")).toEqual({
      ahead: 4,
      behind: 1,
      hasUncommittedChanges: true,
    });
  });

  it("preserves apostrophes in local branch names", () => {
    gitExecMock.mockImplementation((args: string[]) => {
      const command = formatGitArgs(args);
      if (command === "git branch --format=%(refname:short)") {
        return "main\nuser's-branch\n";
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    expect(listBranches("/tmp/repo")).toEqual(["main", "user's-branch"]);
    expect(gitExecMock).toHaveBeenCalledWith(["branch", "--format=%(refname:short)"], { cwd: "/tmp/repo" });
  });

  it("preserves apostrophes in remote branch names", () => {
    gitExecMock.mockImplementation((args: string[]) => {
      const command = formatGitArgs(args);
      if (command === "git branch -r --format=%(refname:short)") {
        return "origin/main\norigin/user's-branch\n";
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    expect(listRemoteBranches("/tmp/repo")).toEqual(["main", "user's-branch"]);
    expect(gitExecMock).toHaveBeenCalledWith(["branch", "-r", "--format=%(refname:short)"], { cwd: "/tmp/repo" });
  });
});
