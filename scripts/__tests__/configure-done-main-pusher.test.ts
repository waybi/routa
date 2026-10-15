import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  TARGET_BOARD_IDS,
  parseArgs,
  runConfigure,
} from "../kanban/configure-done-main-pusher";

const TOPBI_BOARD_ID = "312b1f5a-f1d6-4e51-b0da-334944e64609";
const DEFAULT_BOARD_ID = "a754459a-c6eb-42bb-a4b3-66101ed88c82";

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
  const insert = db.prepare(
    "INSERT INTO kanban_boards (id, workspace_id, name, is_default, columns, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const fixtures: Array<[string, string, string, number, unknown]> = [
    [TARGET_BOARD_IDS[0], "ws-local-tools", "local-tools Board", 1, boardColumns(reporterStep)],
    [TARGET_BOARD_IDS[1], "ws-dsh", "deepseek-harness Board", 1, boardColumns(reporterStep)],
    [TARGET_BOARD_IDS[2], "ws-routa", "Routa Board", 1, boardColumns(reporterStep)],
    [TOPBI_BOARD_ID, "ws-topbi", "TopBI Board", 1, boardColumns(topbiReporterStep)],
    [DEFAULT_BOARD_ID, "default", "Default Workspace Board", 1, boardColumns(reporterStep)],
  ];
  for (const [id, workspaceId, name, isDefault, columns] of fixtures) {
    insert.run(id, workspaceId, name, isDefault, JSON.stringify(columns), 1_700_000_000_000, 1_700_000_000_001);
  }
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

  it("--check prints the current Done steps without touching the database", () => {
    const before = sha256(dbPath);
    const result = runConfigure({ dbPath, mode: "check", backupDir });

    expect(sha256(dbPath)).toBe(before);
    expect(result.boards.map((board) => board.id)).toEqual([...TARGET_BOARD_IDS]);
    expect(result.boards.every((board) => board.doneSteps.join() === "kanban-done-reporter")).toBe(true);
    expect(fs.existsSync(backupDir)).toBe(false);
  });

  it("--apply changes only the Done column of the three target boards, writes a backup, and is idempotent", () => {
    const before = readRows();
    const now = new Date("2026-10-15T08:00:00.000Z");
    const result = runConfigure({ dbPath, mode: "apply", backupDir }, now);
    const after = readRows();

    // Backup holds the original columns of the three target boards.
    expect(result.backupPath).toBeDefined();
    const backup = JSON.parse(fs.readFileSync(result.backupPath!, "utf8")) as Array<{ id: string; columns: string; updated_at: number }>;
    expect(backup.map((entry) => entry.id)).toEqual([...TARGET_BOARD_IDS]);
    for (const entry of backup) {
      expect(entry.columns).toBe(before.get(entry.id)!.columns);
      expect(entry.updated_at).toBe(before.get(entry.id)!.updated_at);
    }

    // Non-target boards are byte-for-byte unchanged.
    for (const id of [TOPBI_BOARD_ID, DEFAULT_BOARD_ID]) {
      expect(after.get(id)).toEqual(before.get(id));
    }

    for (const id of TARGET_BOARD_IDS) {
      const prev = before.get(id)!;
      const next = after.get(id)!;
      expect(doneStepIds(next)).toEqual(["kanban-main-pusher", "kanban-done-reporter"]);
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
