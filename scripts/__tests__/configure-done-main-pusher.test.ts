// @vitest-environment node
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  parseArgs,
  runConfigure,
  type RunResult,
} from "../kanban/configure-done-main-pusher";

const TOPBI_BOARD_ID = "312b1f5a-f1d6-4e51-b0da-334944e64609";
const DEFAULT_BOARD_ID = "a754459a-c6eb-42bb-a4b3-66101ed88c82";
const LOCAL_TOOLS_BOARD_ID = "f635c1de-44a8-4d5c-af42-34244e69eb55";
const DSH_BOARD_ID = "2c17ef3e-411b-4f22-b002-e2b4c9309c91";
const ROUTA_BOARD_ID = "361d06fd-6478-4995-9b6e-ab0b0b271471";
const TURNILO_BOARD_ID = "d13eba6a-42db-43ed-835b-18c544f6c985";
const UNBOUND_BOARD_ID = "edge-unbound";
const MISSING_DIR_BOARD_ID = "edge-missing-dir";
const NO_ORIGIN_BOARD_ID = "edge-no-origin";
const PORT_29418_BOARD_ID = "edge-port-29418";
const NO_REPORTER_BOARD_ID = "edge-no-reporter";

const CONFIGURE_BOARD_IDS = [LOCAL_TOOLS_BOARD_ID, DSH_BOARD_ID, ROUTA_BOARD_ID, TURNILO_BOARD_ID];
const SKIP_BOARD_IDS = [
  TOPBI_BOARD_ID,
  DEFAULT_BOARD_ID,
  UNBOUND_BOARD_ID,
  MISSING_DIR_BOARD_ID,
  NO_ORIGIN_BOARD_ID,
  PORT_29418_BOARD_ID,
  NO_REPORTER_BOARD_ID,
];
const DESIRED_DONE = ["kanban-main-pusher", "kanban-done-reporter"];

function stageColumn(stage: string, position: number) {
  return {
    id: stage,
    name: stage,
    color: "slate",
    position,
    stage,
    automation: {
      enabled: stage !== "blocked",
      steps: [{ id: `${stage}-step`, role: "CRAFTER", specialistId: `kanban-${stage}-specialist` }],
      transitionType: "entry",
    },
  };
}

function boardColumns(doneStep: Record<string, unknown>) {
  return [
    stageColumn("backlog", 0),
    stageColumn("todo", 1),
    stageColumn("dev", 2),
    stageColumn("review", 3),
    {
      id: "done",
      name: "Done",
      color: "emerald",
      position: 4,
      stage: "done",
      automation: {
        enabled: true,
        steps: [doneStep],
        transitionType: "entry",
        deliveryRules: {
          requireCommittedChanges: true,
          requireCleanWorktree: true,
          requirePullRequestReady: true,
        },
        autoAdvanceOnSuccess: false,
        role: doneStep.role,
        specialistId: doneStep.specialistId,
        specialistName: doneStep.specialistName,
        ...(doneStep.providerId ? { providerId: doneStep.providerId } : {}),
        ...(doneStep.specialistLocale ? { specialistLocale: doneStep.specialistLocale } : {}),
      },
    },
    stageColumn("blocked", 5),
  ];
}

const reporterStep = {
  id: "done-reporter",
  role: "GATE",
  specialistId: "kanban-done-reporter",
  specialistName: "Done Reporter",
};

const topbiReporterStep = {
  id: "step-2",
  role: "GATE",
  specialistId: "kanban-done-reporter",
  specialistName: "完成汇报员",
  specialistLocale: "zh-CN",
  providerId: "dsh",
  transport: "acp",
};

interface Row {
  id: string;
  workspace_id: string;
  name: string;
  is_default: number;
  github_token: string | null;
  columns: string;
  created_at: number;
  updated_at: number;
}

let tempDir: string;
let dbPath: string;
let backupDir: string;

function sha256(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function readRows(): Map<string, Row> {
  const db = new BetterSqlite3(dbPath, { readonly: true });
  try {
    const rows = db.prepare("SELECT * FROM kanban_boards").all() as Row[];
    return new Map(rows.map((row) => [row.id, row]));
  } finally {
    db.close();
  }
}

function doneStepIds(row: Row): string[] {
  const columns = JSON.parse(row.columns) as Array<{ stage: string; automation: { steps: Array<{ specialistId: string }> } }>;
  return columns.find((column) => column.stage === "done")!.automation.steps.map((step) => step.specialistId);
}

function makeRepo(name: string, originUrl: string | null): string {
  const dir = path.join(tempDir, "repos", name);
  fs.mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q", dir], { stdio: "ignore" });
  if (originUrl) execFileSync("git", ["-C", dir, "remote", "add", "origin", originUrl], { stdio: "ignore" });
  return dir;
}

function byId(result: RunResult) {
  return new Map(result.boards.map((board) => [board.id, board]));
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "configure-done-main-pusher-"));
  dbPath = path.join(tempDir, "routa.db");
  backupDir = path.join(tempDir, "backups");
  const db = new BetterSqlite3(dbPath);
  db.exec(`CREATE TABLE kanban_boards (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      github_token TEXT,
      columns TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )`);
  db.exec(`CREATE TABLE codebases (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      repo_path TEXT NOT NULL,
      branch TEXT,
      label TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      source_type TEXT,
      source_url TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )`);
  const insert = db.prepare(
    "INSERT INTO kanban_boards (id, workspace_id, name, is_default, columns, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const doneWithoutReporter = {
    id: "done-other",
    role: "GATE",
    specialistId: "kanban-other-gate",
    specialistName: "Other Gate",
  };
  const fixtures: Array<[string, string, string, number, unknown]> = [
    [LOCAL_TOOLS_BOARD_ID, "ws-local-tools", "local-tools Board", 1, boardColumns(reporterStep)],
    [DSH_BOARD_ID, "ws-dsh", "deepseek-harness Board", 1, boardColumns(reporterStep)],
    [ROUTA_BOARD_ID, "ws-routa", "Routa Board", 1, boardColumns(reporterStep)],
    [TURNILO_BOARD_ID, "ws-turnilo", "turnilo Board", 1, boardColumns(reporterStep)],
    [TOPBI_BOARD_ID, "ws-topbi", "TopBI Board", 1, boardColumns(topbiReporterStep)],
    [DEFAULT_BOARD_ID, "default", "Default Workspace Board", 1, boardColumns(reporterStep)],
    [UNBOUND_BOARD_ID, "ws-unbound", "Unbound Board", 1, boardColumns(reporterStep)],
    [MISSING_DIR_BOARD_ID, "ws-missing-dir", "Missing Dir Board", 1, boardColumns(reporterStep)],
    [NO_ORIGIN_BOARD_ID, "ws-no-origin", "No Origin Board", 1, boardColumns(reporterStep)],
    [PORT_29418_BOARD_ID, "ws-port-29418", "Port 29418 Board", 1, boardColumns(reporterStep)],
    [NO_REPORTER_BOARD_ID, "ws-no-reporter", "No Reporter Board", 1, boardColumns(doneWithoutReporter)],
  ];
  fixtures.forEach(([id, workspaceId, name, isDefault, columns], index) => {
    insert.run(id, workspaceId, name, isDefault, JSON.stringify(columns), 1_700_000_000_000 + index, 1_700_000_000_001);
  });

  const insertCodebase = db.prepare("INSERT INTO codebases (id, workspace_id, repo_path) VALUES (?, ?, ?)");
  const codebases: Array<[string, string]> = [
    ["ws-local-tools", makeRepo("repo-local-tools", "git@github.com:example/local-tools.git")],
    ["ws-dsh", makeRepo("repo-dsh", "git@github.com:example/deepseek-harness.git")],
    ["ws-routa", makeRepo("repo-routa", "git@github.com:example/routa.git")],
    ["ws-turnilo", makeRepo("repo-turnilo", "git@github.com:example/turnilo.git")],
    // Real TopBI shape: host contains "gerrit", port is not 29418, repo dir name has no "topbi".
    ["ws-topbi", makeRepo("repo-gr", "ssh://user@gerrit.example.com:27000/topbi")],
    ["default", makeRepo("repo-default-a", "git@github.com:example/a.git")],
    ["default", makeRepo("repo-default-b", "git@github.com:example/b.git")],
    ["ws-missing-dir", path.join(tempDir, "repos", "does-not-exist")],
    ["ws-no-origin", makeRepo("repo-no-origin", null)],
    // Only the :29418 port rule matches (no "gerrit" in host or path).
    ["ws-port-29418", makeRepo("repo-port", "ssh://user@review.example.com:29418/x")],
    ["ws-no-reporter", makeRepo("repo-no-reporter", "git@github.com:example/no-reporter.git")],
  ];
  codebases.forEach(([workspaceId, repoPath], index) => {
    insertCodebase.run(`cb-${index}`, workspaceId, repoPath);
  });
  db.close();
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("configure-done-main-pusher", () => {
  it("parses arguments and requires --db and exactly one mode", () => {
    expect(parseArgs(["--db", "x.db", "--check"])).toEqual({ dbPath: "x.db", mode: "check", backupDir: undefined });
    expect(parseArgs(["--db", "x.db", "--apply", "--backup-dir", "b"])).toEqual({ dbPath: "x.db", mode: "apply", backupDir: "b" });
    expect(() => parseArgs(["--check"])).toThrow("--db");
    expect(() => parseArgs(["--db", "x.db"])).toThrow("exactly one");
    expect(() => parseArgs(["--db", "x.db", "--check", "--apply"])).toThrow("exactly one");
  });

  it("decides per board from the bound codebase and explains every skip", () => {
    let result: RunResult | undefined;
    expect(() => {
      result = runConfigure({ dbPath, mode: "check", backupDir });
    }).not.toThrow();
    const boards = byId(result!);

    expect(boards.size).toBe(CONFIGURE_BOARD_IDS.length + SKIP_BOARD_IDS.length);
    for (const id of CONFIGURE_BOARD_IDS) {
      expect(boards.get(id)!.decision, id).toBe("configure");
      expect(boards.get(id)!.reason, id).toContain(path.join(tempDir, "repos"));
    }
    for (const id of SKIP_BOARD_IDS) {
      expect(boards.get(id)!.decision, id).toBe("skip");
      expect(boards.get(id)!.reason.length, id).toBeGreaterThan(0);
    }
    expect(boards.get(TOPBI_BOARD_ID)!.reason).toContain("Gerrit 走评审，不直推");
    expect(boards.get(PORT_29418_BOARD_ID)!.reason).toContain("Gerrit 走评审，不直推");
    expect(boards.get(DEFAULT_BOARD_ID)!.reason).toContain("多代码仓，不自动推送");
    expect(boards.get(UNBOUND_BOARD_ID)!.reason).toContain("未绑定代码仓");
    expect(boards.get(MISSING_DIR_BOARD_ID)!.reason).toContain("does-not-exist");
    expect(boards.get(NO_ORIGIN_BOARD_ID)!.reason).toContain("没有 origin 远端");
    expect(boards.get(NO_REPORTER_BOARD_ID)!.reason).toContain("kanban-done-reporter");
    // Reasons never leak the user name of an ssh origin URL.
    for (const board of result!.boards) expect(board.reason).not.toContain("user@");
  });

  it("--check prints the current Done steps without touching the database", () => {
    const before = sha256(dbPath);
    const result = runConfigure({ dbPath, mode: "check", backupDir });

    expect(sha256(dbPath)).toBe(before);
    expect(result.boards.every((board) => !board.changed)).toBe(true);
    expect(byId(result).get(ROUTA_BOARD_ID)!.doneSteps).toEqual(["kanban-done-reporter"]);
    expect(byId(result).get(NO_REPORTER_BOARD_ID)!.doneSteps).toEqual(["kanban-other-gate"]);
    expect(fs.existsSync(backupDir)).toBe(false);
  });

  it("--apply changes only the Done column of boards decided as configure, writes a backup, and is idempotent", () => {
    // Pre-configure the Routa board so it is "configure" but already up to date.
    const preDb = new BetterSqlite3(dbPath);
    const routaRow = preDb.prepare("SELECT columns FROM kanban_boards WHERE id = ?").get(ROUTA_BOARD_ID) as { columns: string };
    const routaColumns = JSON.parse(routaRow.columns) as Array<Record<string, any>>;
    const routaDone = routaColumns.find((column) => column.stage === "done")!;
    routaDone.automation.steps = [
      { id: "main-pusher", role: "DEVELOPER", specialistId: "kanban-main-pusher", specialistName: "Main Pusher" },
      reporterStep,
    ];
    preDb.prepare("UPDATE kanban_boards SET columns = ? WHERE id = ?").run(JSON.stringify(routaColumns), ROUTA_BOARD_ID);
    preDb.close();

    const before = readRows();
    const now = new Date("2026-10-15T08:00:00.000Z");
    let result: RunResult | undefined;
    expect(() => {
      result = runConfigure({ dbPath, mode: "apply", backupDir }, now);
    }).not.toThrow();
    const after = readRows();
    const boards = byId(result!);

    const expectedUpdated = CONFIGURE_BOARD_IDS.filter((id) => id !== ROUTA_BOARD_ID);
    expect(result!.boards.filter((board) => board.changed).map((board) => board.id).sort()).toEqual([...expectedUpdated].sort());

    // Backup holds exactly the boards that were changed.
    expect(result!.backupPath).toBeDefined();
    const backup = JSON.parse(fs.readFileSync(result!.backupPath!, "utf8")) as Array<{ id: string; columns: string; updated_at: number }>;
    expect(new Set(backup.map((entry) => entry.id))).toEqual(new Set(expectedUpdated));
    for (const entry of backup) {
      expect(entry.columns).toBe(before.get(entry.id)!.columns);
      expect(entry.updated_at).toBe(before.get(entry.id)!.updated_at);
    }

    // Skipped boards and the already-configured board are unchanged, row for row.
    for (const id of [...SKIP_BOARD_IDS, ROUTA_BOARD_ID]) {
      expect(after.get(id), id).toEqual(before.get(id));
    }
    for (const id of SKIP_BOARD_IDS) expect(boards.get(id)!.decision).toBe("skip");

    for (const id of expectedUpdated) {
      const prev = before.get(id)!;
      const next = after.get(id)!;
      expect(boards.get(id)!.decision).toBe("configure");
      expect(boards.get(id)!.doneSteps).toEqual(DESIRED_DONE);
      expect(doneStepIds(next)).toEqual(DESIRED_DONE);
      expect(next.updated_at).toBe(now.getTime());
      expect({ ...next, columns: "", updated_at: 0 }).toEqual({ ...prev, columns: "", updated_at: 0 });

      const prevColumns = JSON.parse(prev.columns) as Array<Record<string, any>>;
      const nextColumns = JSON.parse(next.columns) as Array<Record<string, any>>;
      expect(nextColumns).toHaveLength(prevColumns.length);
      nextColumns.forEach((column, index) => {
        if (column.stage !== "done") {
          expect(column).toEqual(prevColumns[index]);
          return;
        }
        const prevDone = prevColumns[index]!;
        // Only steps and the mirrored primary-step fields change.
        const { automation, ...rest } = column;
        const { automation: prevAutomation, ...prevRest } = prevDone;
        expect(rest).toEqual(prevRest);
        expect(automation.steps[0]).toEqual({
          id: "main-pusher",
          role: "DEVELOPER",
          specialistId: "kanban-main-pusher",
          specialistName: "Main Pusher",
        });
        expect(automation.steps[1]).toEqual(prevAutomation.steps[0]);
        expect(automation.specialistId).toBe("kanban-main-pusher");
        expect(automation.deliveryRules).toEqual(prevAutomation.deliveryRules);
        expect(automation.transitionType).toBe(prevAutomation.transitionType);
        expect(automation.enabled).toBe(prevAutomation.enabled);
        expect(automation.autoAdvanceOnSuccess).toBe(prevAutomation.autoAdvanceOnSuccess);
      });
    }

    // Second apply: no changes, no new backup.
    const hashAfterFirst = sha256(dbPath);
    const second = runConfigure({ dbPath, mode: "apply", backupDir }, new Date("2026-10-15T09:00:00.000Z"));
    expect(second.backupPath).toBeUndefined();
    expect(second.boards.every((board) => !board.changed)).toBe(true);
    expect(readRows()).toEqual(after);
    expect(sha256(dbPath)).toBe(hashAfterFirst);
    expect(fs.readdirSync(backupDir)).toHaveLength(1);
  });
});
