// @vitest-environment node
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  PROBE_FAILURE_MESSAGE,
  parseArgs,
  runConfigure,
  withFlightChecklist,
  type Options,
} from "../kanban/configure-flight-checklist";

const TOPBI_BOARD_ID = "312b1f5a-f1d6-4e51-b0da-334944e64609";
const LOCAL_TOOLS_BOARD_ID = "f635c1de-44a8-4d5c-af42-34244e69eb55";
const DSH_BOARD_ID = "2c17ef3e-411b-4f22-b002-e2b4c9309c91";
const TURNILO_BOARD_ID = "d13eba6a-42db-43ed-835b-18c544f6c985";
const ROUTA_BOARD_ID = "361d06fd-6478-4995-9b6e-ab0b0b271471";
const DEFAULT_BOARD_ID = "a754459a-c6eb-42bb-a4b3-66101ed88c82";
const ALL_BOARD_IDS = [TOPBI_BOARD_ID, LOCAL_TOOLS_BOARD_ID, DSH_BOARD_ID, TURNILO_BOARD_ID, ROUTA_BOARD_ID, DEFAULT_BOARD_ID];

const NEW_IDS = [
  "kanban-contract-setter",
  "kanban-flight-dev-executor",
  "kanban-flight-review-guard",
  "kanban-high-risk-reviewer",
];
const PORTER_ID = "kanban-topbi-porter";

type Step = Record<string, unknown>;
type Column = { id: string; stage: string; automation: Record<string, any>; [key: string]: unknown };
interface Row {
  id: string;
  workspace_id: string;
  name: string;
  columns: string;
  created_at: number;
  updated_at: number;
}

/** TopBI shape: every step carries providerId dsh, zh-CN locale, acp transport and a Chinese name. */
function topbiStep(id: string, role: string, specialistId: string, specialistName: string): Step {
  return { id, role, specialistId, specialistName, specialistLocale: "zh-CN", providerId: "dsh", transport: "acp" };
}

function plainStep(id: string, role: string, specialistId: string, specialistName: string): Step {
  return { id, role, specialistId, specialistName };
}

function column(stage: string, position: number, steps: Step[], extra: Record<string, unknown> = {}): Column {
  const first = steps[0] ?? {};
  return {
    id: stage,
    name: stage,
    color: "slate",
    position,
    stage,
    automation: {
      enabled: stage !== "blocked",
      steps,
      transitionType: "entry",
      autoAdvanceOnSuccess: false,
      role: first.role,
      specialistId: first.specialistId,
      specialistName: first.specialistName,
      ...(first.providerId ? { providerId: first.providerId } : {}),
      ...(first.specialistLocale ? { specialistLocale: first.specialistLocale } : {}),
      ...extra,
    },
  };
}

function topbiColumns(): Column[] {
  return [
    column("backlog", 0, [topbiStep("backlog-refiner", "CRAFTER", "kanban-backlog-refiner", "需求梳理员")]),
    column("todo", 1, [topbiStep("todo-orchestrator", "CRAFTER", "kanban-todo-orchestrator", "Todo 编排员")], {
      contractRules: { requireCanonicalStory: true },
    }),
    column("dev", 2, [topbiStep("dev-executor", "CRAFTER", "kanban-dev-executor", "开发执行员")], {
      requiredTaskFields: ["scope"],
    }),
    column(
      "review",
      3,
      [
        topbiStep("qa-frontend", "GATE", "kanban-qa-frontend", "前端质量守卫"),
        // One replaced step carries a pinned model and effort; they must move to the new step.
        { ...topbiStep("review-guard", "GATE", "kanban-review-guard", "评审守卫"), model: "claude-opus-5-5", reasoningEffort: "high" },
      ],
      { requiredArtifacts: ["screenshot", "test_results"], deliveryRules: { requireCommittedChanges: true } },
    ),
    column("done", 4, [topbiStep("step-2", "GATE", "kanban-done-reporter", "完成汇报员")], {
      deliveryRules: { requireCleanWorktree: true },
    }),
    column("blocked", 5, [topbiStep("blocked-resolver", "CRAFTER", "kanban-blocked-resolver", "阻塞处理员")]),
  ];
}

function plainColumns(): Column[] {
  return [
    column("backlog", 0, [plainStep("backlog-refiner", "CRAFTER", "kanban-backlog-refiner", "Backlog Refiner")]),
    column("todo", 1, [plainStep("todo-orchestrator", "CRAFTER", "kanban-todo-orchestrator", "Todo Orchestrator")]),
    column("dev", 2, [{ ...plainStep("dev-executor", "CRAFTER", "kanban-dev-executor", "Dev Crafter"), providerId: "dsh", model: "gpt-6.1-sol" }]),
    column(
      "review",
      3,
      [
        plainStep("qa-frontend", "GATE", "kanban-qa-frontend", "QA Frontend"),
        plainStep("review-guard", "GATE", "kanban-review-guard", "Review Guard"),
      ],
      { requiredArtifacts: ["screenshot", "test_results"] },
    ),
    column("done", 4, [
      plainStep("main-pusher", "DEVELOPER", "kanban-main-pusher", "Main Pusher"),
      plainStep("done-reporter", "GATE", "kanban-done-reporter", "Done Reporter"),
    ]),
    column("blocked", 5, [plainStep("blocked-resolver", "CRAFTER", "kanban-blocked-resolver", "Blocked Resolver")]),
  ];
}

let tempDir: string;
let dbPath: string;
let backupDir: string;
let server: http.Server;
let baseUrl: string;
let loadedIds: Set<string>;
let probedIds: string[];

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

function columnsOf(row: Row): Column[] {
  return JSON.parse(row.columns) as Column[];
}

function stage(columns: Column[], name: string): Column {
  return columns.find((entry) => entry.stage === name)!;
}

function stepIds(columns: Column[], name: string): string[] {
  return (stage(columns, name).automation.steps as Step[]).map((step) => step.specialistId as string);
}

function options(extra: Partial<Options>): Options {
  return {
    dbPath,
    mode: "check",
    boards: [],
    baseUrl,
    backupDir,
    allowRoutaBoard: false,
    force: false,
    ...extra,
  };
}

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "configure-flight-checklist-"));
  dbPath = path.join(tempDir, "routa.db");
  backupDir = path.join(tempDir, "backups");
  const db = new BetterSqlite3(dbPath);
  db.exec(`CREATE TABLE kanban_boards (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      columns TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
  const insert = db.prepare(
    "INSERT INTO kanban_boards (id, workspace_id, name, columns, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const fixtures: Array<[string, string, Column[]]> = [
    [TOPBI_BOARD_ID, "TopBI Board", topbiColumns()],
    [LOCAL_TOOLS_BOARD_ID, "local-tools Board", plainColumns()],
    [DSH_BOARD_ID, "deepseek-harness Board", plainColumns()],
    [TURNILO_BOARD_ID, "turnilo Board", plainColumns()],
    [ROUTA_BOARD_ID, "Routa Board", plainColumns()],
    [DEFAULT_BOARD_ID, "Default Workspace Board", plainColumns()],
  ];
  fixtures.forEach(([id, name, columns], index) => {
    insert.run(id, `ws-${index}`, name, JSON.stringify(columns), 1_700_000_000_000 + index, 1_700_000_000_100 + index);
  });
  db.close();

  loadedIds = new Set([...NEW_IDS, PORTER_ID]);
  probedIds = [];
  server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const id = url.searchParams.get("id") ?? "";
    if (url.pathname === "/api/specialists" && id) probedIds.push(id);
    const ok = url.pathname === "/api/specialists" && loadedIds.has(id);
    response.writeHead(ok ? 200 : 404, { "content-type": "application/json" });
    response.end(JSON.stringify(ok ? { id } : { error: "Specialist not found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("parseArgs", () => {
  it("requires --db, exactly one mode and --boards", () => {
    expect(parseArgs(["--db", "x.db", "--check", "--boards", "f635c1de,312b1f5a"])).toEqual({
      dbPath: "x.db",
      mode: "check",
      boards: ["f635c1de", "312b1f5a"],
      baseUrl: "http://127.0.0.1:3000",
      backupDir: undefined,
      rollbackFile: undefined,
      allowRoutaBoard: false,
      force: false,
    });
    expect(parseArgs(["--db", "x.db", "--rollback", "b.json", "--boards", "f635c1de", "--force", "--base-url", "http://h:1"])).toMatchObject({
      mode: "rollback",
      rollbackFile: "b.json",
      force: true,
      baseUrl: "http://h:1",
    });
    expect(() => parseArgs(["--db", "x.db", "--check"])).toThrow("--boards");
    expect(() => parseArgs(["--db", "x.db", "--check", "--boards", " , "])).toThrow("--boards");
    expect(() => parseArgs(["--check", "--boards", "f635c1de"])).toThrow("--db");
    expect(() => parseArgs(["--db", "x.db", "--boards", "f635c1de"])).toThrow("exactly one");
    expect(() => parseArgs(["--db", "x.db", "--check", "--apply", "--boards", "f635c1de"])).toThrow("exactly one");
    expect(() => parseArgs(["--db", "x.db", "--check", "--boards", "f635c1de", "--bogus"])).toThrow("Unknown argument");
  });

  it("CLI exits non-zero with a --boards error when --boards is missing", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/kanban/configure-flight-checklist.ts", "--db", dbPath, "--check"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--boards");
  });
});

describe("board selection", () => {
  it("--apply changes only the boards listed in --boards (8-char prefixes accepted)", async () => {
    const before = readRows();
    const result = await runConfigure(options({ mode: "apply", boards: ["f635c1de", DSH_BOARD_ID] }));
    const after = readRows();

    expect(result.exitCode).toBe(0);
    expect(result.boards.map((board) => board.id).sort()).toEqual([DSH_BOARD_ID, LOCAL_TOOLS_BOARD_ID].sort());
    for (const id of [TOPBI_BOARD_ID, TURNILO_BOARD_ID, ROUTA_BOARD_ID, DEFAULT_BOARD_ID]) {
      expect(after.get(id), id).toEqual(before.get(id));
    }
    for (const id of [DSH_BOARD_ID, LOCAL_TOOLS_BOARD_ID]) {
      expect(after.get(id)!.columns, id).not.toBe(before.get(id)!.columns);
    }
  });

  it("refuses the Routa Board unless --allow-routa-board is given", async () => {
    const hash = sha256(dbPath);
    await expect(runConfigure(options({ mode: "apply", boards: ["361d06fd"] }))).rejects.toThrow("--allow-routa-board");
    await expect(runConfigure(options({ mode: "check", boards: [ROUTA_BOARD_ID] }))).rejects.toThrow("--allow-routa-board");
    expect(sha256(dbPath)).toBe(hash);

    const allowed = await runConfigure(options({ mode: "apply", boards: ["361d06fd"], allowRoutaBoard: true }));
    expect(allowed.boards.map((board) => board.id)).toEqual([ROUTA_BOARD_ID]);
    expect(stepIds(columnsOf(readRows().get(ROUTA_BOARD_ID)!), "dev")).toEqual(["kanban-flight-dev-executor"]);
  });

  it("rejects unknown or ambiguous board ids without writing", async () => {
    const hash = sha256(dbPath);
    await expect(runConfigure(options({ mode: "apply", boards: ["deadbeef"] }))).rejects.toThrow("deadbeef");
    await expect(runConfigure(options({ mode: "apply", boards: [""] }))).rejects.toThrow();
    expect(sha256(dbPath)).toBe(hash);
  });
});

describe("target columns", () => {
  it("builds todo/dev/review steps and carries providerId/model/reasoningEffort/specialistLocale over", async () => {
    const before = readRows();
    const result = await runConfigure(options({ mode: "apply", boards: ["312b1f5a", "f635c1de"] }));
    expect(result.exitCode).toBe(0);
    const after = readRows();

    for (const id of [TOPBI_BOARD_ID, LOCAL_TOOLS_BOARD_ID]) {
      const prev = columnsOf(before.get(id)!);
      const next = columnsOf(after.get(id)!);
      expect(stepIds(next, "todo")).toEqual(["kanban-todo-orchestrator", "kanban-contract-setter"]);
      expect(stepIds(next, "dev")).toEqual(["kanban-flight-dev-executor"]);
      expect(stepIds(next, "review")).toEqual(["kanban-qa-frontend", "kanban-flight-review-guard", "kanban-high-risk-reviewer"]);
      // Untouched steps stay byte-for-byte equal.
      expect(stage(next, "todo").automation.steps[0]).toEqual(stage(prev, "todo").automation.steps[0]);
      expect(stage(next, "review").automation.steps[0]).toEqual(stage(prev, "review").automation.steps[0]);
      // Columns that the flight checklist does not touch are unchanged.
      expect(stage(next, "backlog")).toEqual(stage(prev, "backlog"));
      expect(stage(next, "blocked")).toEqual(stage(prev, "blocked"));
      // Other column fields stay; only steps and the mirrored primary-step fields move.
      for (const name of ["todo", "dev", "review"]) {
        const { automation, ...rest } = stage(next, name);
        const { automation: prevAutomation, ...prevRest } = stage(prev, name);
        expect(rest).toEqual(prevRest);
        const strip = (value: Record<string, unknown>) => {
          const { steps: _s, role: _r, specialistId: _i, specialistName: _n, ...others } = value;
          return others;
        };
        expect(strip(automation)).toEqual(strip(prevAutomation));
        expect(automation.role).toBe(automation.steps[0].role);
        expect(automation.specialistId).toBe(automation.steps[0].specialistId);
        expect(automation.specialistName).toBe(automation.steps[0].specialistName);
      }
    }

    const topbi = columnsOf(after.get(TOPBI_BOARD_ID)!);
    expect(stage(topbi, "todo").automation.steps[1]).toEqual({
      id: "contract-setter",
      role: "CRAFTER",
      specialistId: "kanban-contract-setter",
      specialistName: "出题人",
      specialistLocale: "zh-CN",
      providerId: "dsh",
      transport: "acp",
    });
    expect(stage(topbi, "dev").automation.steps[0]).toEqual({
      id: "flight-dev-executor",
      role: "CRAFTER",
      specialistId: "kanban-flight-dev-executor",
      specialistName: "开发执行员（起飞检查单）",
      specialistLocale: "zh-CN",
      providerId: "dsh",
      transport: "acp",
    });
    expect(stage(topbi, "dev").automation.specialistName).toBe("开发执行员（起飞检查单）");
    const topbiReview = stage(topbi, "review").automation.steps;
    expect(topbiReview[1]).toMatchObject({
      id: "flight-review-guard",
      role: "GATE",
      specialistName: "评审守卫（起飞检查单）",
      providerId: "dsh",
      specialistLocale: "zh-CN",
      model: "claude-opus-5-5",
      reasoningEffort: "high",
    });
    expect(topbiReview[2]).toMatchObject({ id: "high-risk-reviewer", role: "GATE", specialistName: "高风险复核员", providerId: "dsh" });

    const local = columnsOf(after.get(LOCAL_TOOLS_BOARD_ID)!);
    expect(stage(local, "dev").automation.steps[0]).toEqual({
      id: "flight-dev-executor",
      role: "CRAFTER",
      specialistId: "kanban-flight-dev-executor",
      specialistName: "Flight Dev Crafter",
      providerId: "dsh",
      model: "gpt-6.1-sol",
    });
    expect(stage(local, "dev").automation.specialistName).toBe("Flight Dev Crafter");
    expect(stage(local, "review").automation.steps[1]).toEqual({
      id: "flight-review-guard",
      role: "GATE",
      specialistId: "kanban-flight-review-guard",
      specialistName: "Flight Review Guard",
    });
    expect(stage(local, "todo").automation.steps[1]).not.toHaveProperty("specialistLocale");
  });

  it("puts kanban-topbi-porter first in the TopBI done column and leaves other done columns unchanged", async () => {
    const before = readRows();
    await runConfigure(options({ mode: "apply", boards: ["312b1f5a", "f635c1de", "2c17ef3e", "d13eba6a"] }));
    const after = readRows();

    const topbiDone = stage(columnsOf(after.get(TOPBI_BOARD_ID)!), "done");
    const prevTopbiDone = stage(columnsOf(before.get(TOPBI_BOARD_ID)!), "done");
    expect(topbiDone.automation.steps.map((step: Step) => step.specialistId)).toEqual([PORTER_ID, "kanban-done-reporter"]);
    expect(topbiDone.automation.steps[1]).toEqual(prevTopbiDone.automation.steps[0]);
    expect(topbiDone.automation.steps[0]).toEqual({
      id: "topbi-porter",
      role: "DEVELOPER",
      specialistId: PORTER_ID,
      specialistName: "TopBI 移植员",
      specialistLocale: "zh-CN",
      providerId: "dsh",
      transport: "acp",
    });
    expect(topbiDone.automation.specialistId).toBe(PORTER_ID);
    expect(topbiDone.automation.role).toBe("DEVELOPER");
    expect(topbiDone.automation.deliveryRules).toEqual(prevTopbiDone.automation.deliveryRules);

    for (const id of [LOCAL_TOOLS_BOARD_ID, DSH_BOARD_ID, TURNILO_BOARD_ID]) {
      expect(stage(columnsOf(after.get(id)!), "done"), id).toEqual(stage(columnsOf(before.get(id)!), "done"));
    }
  });

  it("refuses to force a column whose original step is missing", () => {
    const broken = plainColumns().map((entry) =>
      entry.stage === "review"
        ? column("review", 3, [plainStep("qa-frontend", "GATE", "kanban-qa-frontend", "QA Frontend")])
        : entry,
    );
    expect(() => withFlightChecklist(broken, LOCAL_TOOLS_BOARD_ID)).toThrow("kanban-review-guard");
  });
});

describe("runtime probe", () => {
  it("--apply with any 404 writes nothing, creates no backup and exits 3", async () => {
    loadedIds.delete("kanban-high-risk-reviewer");
    const hash = sha256(dbPath);
    const result = await runConfigure(options({ mode: "apply", boards: ["f635c1de"] }));

    expect(result.exitCode).toBe(3);
    expect(result.message).toBe(PROBE_FAILURE_MESSAGE);
    expect(PROBE_FAILURE_MESSAGE).toContain("Routa 进程还没加载新岗位文件（岗位文件按进程缓存，要重启 Routa 才读到）");
    expect(result.probes.find((probe) => probe.id === "kanban-high-risk-reviewer")!.status).toBe(404);
    expect(sha256(dbPath)).toBe(hash);
    expect(fs.existsSync(backupDir)).toBe(false);
    expect(new Set(probedIds)).toEqual(new Set(NEW_IDS));
  });

  it("probes the porter only when the TopBI board is listed, and treats an unreachable Routa as a failure", async () => {
    loadedIds.delete(PORTER_ID);
    const hash = sha256(dbPath);
    const topbi = await runConfigure(options({ mode: "apply", boards: ["312b1f5a"] }));
    expect(topbi.exitCode).toBe(3);
    expect(topbi.probes.find((probe) => probe.id === PORTER_ID)!.status).toBe(404);

    const unreachable = await runConfigure(options({ mode: "apply", boards: ["f635c1de"], baseUrl: "http://127.0.0.1:9" }));
    expect(unreachable.exitCode).toBe(3);
    expect(unreachable.probes.every((probe) => probe.status === "unreachable")).toBe(true);
    expect(sha256(dbPath)).toBe(hash);
  });

  it("--check is read-only, prints probe results and before/after steps, and exits 0 even with 404", async () => {
    loadedIds.clear();
    const hash = sha256(dbPath);
    const result = await runConfigure(options({ mode: "check", boards: ["312b1f5a", "f635c1de"] }));

    expect(result.exitCode).toBe(0);
    expect(sha256(dbPath)).toBe(hash);
    expect(fs.existsSync(backupDir)).toBe(false);
    expect(result.probes.map((probe) => [probe.id, probe.status])).toEqual([...NEW_IDS, PORTER_ID].map((id) => [id, 404]));
    const topbi = result.boards.find((board) => board.id === TOPBI_BOARD_ID)!;
    expect(topbi.before.dev).toEqual(["kanban-dev-executor"]);
    expect(topbi.after.done).toEqual([PORTER_ID, "kanban-done-reporter"]);
    expect(result.output).toContain("kanban-high-risk-reviewer");
    expect(result.output).toContain("404");
  });

  it("CLI exits 3 with the restart message when the probe fails", () => {
    loadedIds.clear();
    const hash = sha256(dbPath);
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/kanban/configure-flight-checklist.ts", "--db", dbPath, "--apply", "--boards", "f635c1de", "--base-url", baseUrl, "--backup-dir", backupDir],
      { encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(3);
    expect(result.stdout + result.stderr).toContain("要重启 Routa 才读到");
    expect(sha256(dbPath)).toBe(hash);
  });
});

describe("backup, idempotency and rollback", () => {
  it("--apply writes a wx backup with old/new columns and updated_at; repeating it writes nothing", async () => {
    const before = readRows();
    const now = new Date("2026-10-22T08:00:00.000Z");
    const first = await runConfigure(options({ mode: "apply", boards: ["312b1f5a", "f635c1de"] }), { now });
    const after = readRows();

    expect(first.backupPath).toBeDefined();
    expect(path.dirname(first.backupPath!)).toBe(backupDir);
    expect(path.basename(first.backupPath!)).toMatch(/^kanban-flight-checklist-backup-.+\.json$/);
    const backup = JSON.parse(fs.readFileSync(first.backupPath!, "utf8")) as { boards: Array<Record<string, any>> };
    expect(backup.boards.map((entry) => entry.id).sort()).toEqual([LOCAL_TOOLS_BOARD_ID, TOPBI_BOARD_ID].sort());
    for (const entry of backup.boards) {
      expect(entry.columns).toBe(before.get(entry.id)!.columns);
      expect(entry.updated_at).toBe(before.get(entry.id)!.updated_at);
      expect(entry.newColumns).toBe(after.get(entry.id)!.columns);
      expect(after.get(entry.id)!.updated_at).toBe(now.getTime());
    }

    // Same second → same file name → the wx flag refuses to overwrite.
    const db = new BetterSqlite3(dbPath);
    db.prepare("UPDATE kanban_boards SET columns = ? WHERE id = ?").run(before.get(DSH_BOARD_ID)!.columns, DSH_BOARD_ID);
    db.close();
    await expect(runConfigure(options({ mode: "apply", boards: ["2c17ef3e"] }), { now })).rejects.toThrow(/EEXIST|exists/);
    expect(readRows().get(DSH_BOARD_ID)).toEqual(before.get(DSH_BOARD_ID));

    const hash = sha256(dbPath);
    const second = await runConfigure(options({ mode: "apply", boards: ["312b1f5a", "f635c1de"] }), { now: new Date("2026-10-22T09:00:00.000Z") });
    expect(second.exitCode).toBe(0);
    expect(second.backupPath).toBeUndefined();
    expect(second.boards.every((board) => !board.changed)).toBe(true);
    expect(sha256(dbPath)).toBe(hash);
    expect(fs.readdirSync(backupDir)).toHaveLength(1);
  });

  it("treats a board whose JSON keys were reordered by Routa as already configured", async () => {
    const first = await runConfigure(options({ mode: "apply", boards: ["f635c1de"] }), { now: new Date("2026-10-22T08:00:00.000Z") });
    expect(first.backupPath).toBeDefined();
    const db = new BetterSqlite3(dbPath);
    const row = db.prepare("SELECT columns FROM kanban_boards WHERE id = ?").get(LOCAL_TOOLS_BOARD_ID) as { columns: string };
    const reordered = (JSON.parse(row.columns) as Column[]).map((entry) => {
      const { stage: stageName, ...rest } = entry;
      return { stage: stageName, ...rest };
    });
    db.prepare("UPDATE kanban_boards SET columns = ? WHERE id = ?").run(JSON.stringify(reordered), LOCAL_TOOLS_BOARD_ID);
    db.close();
    const hash = sha256(dbPath);
    const again = await runConfigure(options({ mode: "apply", boards: ["f635c1de"] }), { now: new Date("2026-10-22T09:00:00.000Z") });
    expect(again.backupPath).toBeUndefined();
    expect(sha256(dbPath)).toBe(hash);
  });

  it("--rollback restores the original columns and updated_at when current columns equal the backup's new columns", async () => {
    const before = readRows();
    const applied = await runConfigure(options({ mode: "apply", boards: ["312b1f5a", "f635c1de"] }), { now: new Date("2026-10-22T08:00:00.000Z") });

    // Key order changes by Routa must not block the rollback (deep comparison).
    const db = new BetterSqlite3(dbPath);
    const row = db.prepare("SELECT columns FROM kanban_boards WHERE id = ?").get(TOPBI_BOARD_ID) as { columns: string };
    const reordered = (JSON.parse(row.columns) as Column[]).map(({ automation, ...rest }) => ({ automation, ...rest }));
    db.prepare("UPDATE kanban_boards SET columns = ? WHERE id = ?").run(JSON.stringify(reordered), TOPBI_BOARD_ID);
    db.close();

    const result = await runConfigure(options({ mode: "rollback", rollbackFile: applied.backupPath, boards: ["312b1f5a", "f635c1de"] }));
    expect(result.exitCode).toBe(0);
    expect(readRows()).toEqual(before);
  });

  it("--rollback refuses and lists the differences when someone changed the board afterwards; --force writes anyway", async () => {
    const before = readRows();
    const applied = await runConfigure(options({ mode: "apply", boards: ["312b1f5a", "f635c1de"] }), { now: new Date("2026-10-22T08:00:00.000Z") });

    const db = new BetterSqlite3(dbPath);
    const row = db.prepare("SELECT columns FROM kanban_boards WHERE id = ?").get(LOCAL_TOOLS_BOARD_ID) as { columns: string };
    const edited = JSON.parse(row.columns) as Column[];
    stage(edited, "review").automation.steps[2].model = "someone-else";
    db.prepare("UPDATE kanban_boards SET columns = ? WHERE id = ?").run(JSON.stringify(edited), LOCAL_TOOLS_BOARD_ID);
    db.close();
    const edits = readRows();
    const hash = sha256(dbPath);

    const refused = runConfigure(options({ mode: "rollback", rollbackFile: applied.backupPath, boards: ["312b1f5a", "f635c1de"] }));
    await expect(refused).rejects.toThrow(LOCAL_TOOLS_BOARD_ID);
    await expect(
      runConfigure(options({ mode: "rollback", rollbackFile: applied.backupPath, boards: ["312b1f5a", "f635c1de"] })),
    ).rejects.toThrow(/review/);
    // Refusal is all-or-nothing: the TopBI board (which matches) is not restored either.
    expect(sha256(dbPath)).toBe(hash);
    expect(readRows().get(TOPBI_BOARD_ID)).toEqual(edits.get(TOPBI_BOARD_ID));

    const forced = await runConfigure(
      options({ mode: "rollback", rollbackFile: applied.backupPath, boards: ["312b1f5a", "f635c1de"], force: true }),
    );
    expect(forced.exitCode).toBe(0);
    expect(readRows()).toEqual(before);
  });
});
