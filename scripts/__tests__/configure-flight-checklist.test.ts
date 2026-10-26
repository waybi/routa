// @vitest-environment node
import { spawn, spawnSync } from "node:child_process";
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
import { MAIN_PUSHER_STEP } from "../kanban/configure-done-main-pusher";

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
const PUSHER_ID = "kanban-main-pusher";
const REPORTER_ID = "kanban-done-reporter";

/** Codebases per board workspace; the Default workspace has two repositories, like the real one. */
const REPOS: Record<string, string[]> = {
  [TOPBI_BOARD_ID]: ["/repos/topbi"],
  [LOCAL_TOOLS_BOARD_ID]: ["/repos/local-tools"],
  [DSH_BOARD_ID]: ["/repos/deepseek-harness"],
  [TURNILO_BOARD_ID]: ["/repos/turnilo"],
  [ROUTA_BOARD_ID]: ["/repos/routa"],
  [DEFAULT_BOARD_ID]: ["/repos/topbi", "/repos/routa"],
};

/** Stand-in for flight_resolve.py: logs argv to calls.log and answers from stub.json keyed by --repo. */
const RESOLVER_STUB = `import json, os, sys, time
here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "calls.log"), "a") as log:
    log.write(json.dumps(sys.argv[1:]) + "\\n")
config = json.load(open(os.path.join(here, "stub.json")))
entry = config[sys.argv[sys.argv.index("--repo") + 1]]
time.sleep(entry.get("sleep", 0))
sys.stderr.write(entry.get("stderr", ""))
sys.stdout.write(entry["stdout"] if "stdout" in entry else json.dumps(entry["json"]))
sys.exit(entry.get("exit", 0))
`;

type StubEntry = { json?: unknown; stdout?: string; stderr?: string; exit?: number; sleep?: number };

function standard(project: string, delivery: string, doneSteps: unknown, registered = true): StubEntry {
  return { json: { registered, project, delivery, done_steps: doneSteps, packs: [project], verify_commands: [] } };
}
const MAIN_PUSH = [PUSHER_ID, REPORTER_ID];
const PORT = [PORTER_ID, REPORTER_ID];

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
let resolverDir: string;
let resolver: string;
let savedResolverEnv: string | undefined;

function setStub(repo: string, entry: StubEntry): void {
  const file = path.join(resolverDir, "stub.json");
  const config = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, StubEntry>;
  config[repo] = entry;
  fs.writeFileSync(file, JSON.stringify(config));
}

function resolverCalls(): string[][] {
  const file = path.join(resolverDir, "calls.log");
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
}

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
  db.exec(`CREATE TABLE codebases (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, repo_path TEXT NOT NULL)`);
  const insertCodebase = db.prepare("INSERT INTO codebases (id, workspace_id, repo_path) VALUES (?, ?, ?)");
  fixtures.forEach(([id, name, columns], index) => {
    insert.run(id, `ws-${index}`, name, JSON.stringify(columns), 1_700_000_000_000 + index, 1_700_000_000_100 + index);
    REPOS[id]!.forEach((repo, repoIndex) => insertCodebase.run(`cb-${index}-${repoIndex}`, `ws-${index}`, repo));
  });
  db.close();

  // Hermetic resolver: every test (and every spawned CLI) uses the stub, never the real Vault.
  resolverDir = path.join(tempDir, "resolver");
  fs.mkdirSync(resolverDir);
  resolver = path.join(resolverDir, "flight_resolve_stub.py");
  fs.writeFileSync(resolver, RESOLVER_STUB);
  fs.writeFileSync(
    path.join(resolverDir, "stub.json"),
    JSON.stringify({
      "/repos/topbi": standard("topbi", "port-dev-alpha", PORT),
      "/repos/local-tools": standard("local-tools", "main-push", MAIN_PUSH),
      "/repos/deepseek-harness": standard("deepseek-harness", "main-push", MAIN_PUSH),
      "/repos/turnilo": standard("turnilo", "main-push", MAIN_PUSH),
      "/repos/routa": standard("routa", "main-push", MAIN_PUSH),
    }),
  );
  savedResolverEnv = process.env.FLIGHT_RESOLVE;
  process.env.FLIGHT_RESOLVE = resolver;

  loadedIds = new Set([...NEW_IDS, PORTER_ID, PUSHER_ID]);
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
  if (savedResolverEnv === undefined) delete process.env.FLIGHT_RESOLVE;
  else process.env.FLIGHT_RESOLVE = savedResolverEnv;
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

  it("puts kanban-topbi-porter first in the TopBI done column (port-dev-alpha) and leaves main-push done columns unchanged", async () => {
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
    expect(new Set(probedIds)).toEqual(new Set([...NEW_IDS, PUSHER_ID]));
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
    expect(result.probes.map((probe) => [probe.id, probe.status])).toEqual([...NEW_IDS, PORTER_ID, PUSHER_ID].map((id) => [id, 404]));
    const topbi = result.boards.find((board) => board.id === TOPBI_BOARD_ID)!;
    expect(topbi.before.dev).toEqual(["kanban-dev-executor"]);
    expect(topbi.after.done).toEqual([PORTER_ID, "kanban-done-reporter"]);
    expect(result.output).toContain("kanban-high-risk-reviewer");
    expect(result.output).toContain("404");
  });

  it("CLI exits 3 with the restart message when the probe gets 404", async () => {
    loadedIds.clear();
    const hash = sha256(dbPath);
    // Async spawn: the fake server lives in this process and must keep answering while the CLI runs.
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "scripts/kanban/configure-flight-checklist.ts", "--db", dbPath, "--apply", "--boards", "f635c1de", "--base-url", baseUrl, "--backup-dir", backupDir],
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const status = await new Promise<number | null>((resolve) => child.on("close", resolve));

    expect(status, stderr).toBe(3);
    expect(stdout).toContain("kanban-contract-setter  404");
    expect(stdout + stderr).toContain("要重启 Routa 才读到");
    expect(new Set(probedIds)).toEqual(new Set([...NEW_IDS, PUSHER_ID]));
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

describe("Done lane from flight_resolve.py done_steps", () => {
  const doneOf = (id: string) => stage(columnsOf(readRows().get(id)!), "done");
  const flightLine = (output: string, id: string) => output.split("\n").find((line) => line.includes(`flight: ${id.slice(0, 8)}`)) ?? "";

  function setDoneSteps(boardId: string, steps: Step[]): void {
    const db = new BetterSqlite3(dbPath);
    const row = db.prepare("SELECT columns FROM kanban_boards WHERE id = ?").get(boardId) as { columns: string };
    const columns = (JSON.parse(row.columns) as Column[]).map((entry) => (entry.stage === "done" ? column("done", 4, steps) : entry));
    db.prepare("UPDATE kanban_boards SET columns = ? WHERE id = ?").run(JSON.stringify(columns), boardId);
    db.close();
  }

  it.each([
    ["main-push", MAIN_PUSH, [PUSHER_ID]],
    ["port-dev-alpha", PORT, [PORTER_ID]],
    ["none", [REPORTER_ID], []],
  ])("C1 %s: --apply orders the Done column exactly as done_steps and probes the template ids", async (delivery, doneSteps, probed) => {
    setStub("/repos/local-tools", standard("local-tools", delivery, doneSteps));
    const before = doneOf(LOCAL_TOOLS_BOARD_ID);
    const result = await runConfigure(options({ mode: "apply", boards: ["f635c1de"] }));

    expect(result.exitCode).toBe(0);
    const after = doneOf(LOCAL_TOOLS_BOARD_ID);
    expect(after.automation.steps.map((step: Step) => step.specialistId)).toEqual(doneSteps);
    expect(after.automation.specialistId).toBe(doneSteps[0]);
    const reporter = before.automation.steps.find((step: Step) => step.specialistId === REPORTER_ID);
    expect(after.automation.steps.at(-1)).toEqual(reporter);
    if (delivery === "port-dev-alpha") {
      expect(after.automation.steps[0]).toEqual({ id: "topbi-porter", role: "DEVELOPER", specialistId: PORTER_ID, specialistName: "TopBI Porter" });
    }
    expect(resolverCalls()).toEqual([["--repo", "/repos/local-tools", "--format", "json"]]);
    expect(result.probes.map((probe) => probe.id)).toEqual([...NEW_IDS, ...probed]);
    expect(result.boards[0]!.flight).toMatchObject({ delivery, doneSteps, doneChanged: delivery !== "main-push" });
  });

  it("C2 an unregistered done_steps id fails --apply and --check, writes nothing and creates no backup", async () => {
    setStub("/repos/local-tools", standard("local-tools", "main-push", ["kanban-foo", REPORTER_ID]));
    const before = readRows();
    for (const mode of ["apply", "check"] as const) {
      await expect(runConfigure(options({ mode, boards: ["2c17ef3e", "f635c1de"] }))).rejects.toThrow("kanban-foo");
    }
    expect(readRows()).toEqual(before);
    expect(fs.existsSync(backupDir)).toBe(false);

    const child = spawnSync(process.execPath, ["--import", "tsx", "scripts/kanban/configure-flight-checklist.ts", "--db", dbPath, "--apply", "--boards", "f635c1de", "--base-url", baseUrl], {
      encoding: "utf8",
    });
    expect(child.status).toBe(1);
    expect(child.stderr).toContain("kanban-foo");
    expect(readRows()).toEqual(before);
  });

  it.each([
    ["exit 1", { exit: 1, stderr: "匹配到 0 张卡" }, "匹配到 0 张卡"],
    ["not JSON", { stdout: "Traceback: boom" }, "did not print JSON"],
    ["done_steps missing", { json: { registered: true, project: "local-tools", delivery: "main-push" } }, "no done_steps"],
    ["done_steps not an array", standard("local-tools", "main-push", "kanban-main-pusher"), "no done_steps"],
  ])("C3 resolver failure (%s) aborts the run and leaves every board unchanged", async (_label, entry, reason) => {
    setStub("/repos/local-tools", entry as StubEntry);
    const before = readRows();
    for (const mode of ["apply", "check"] as const) {
      const run = runConfigure(options({ mode, boards: ["2c17ef3e", "f635c1de"] }));
      await expect(run).rejects.toThrow(reason);
      await expect(runConfigure(options({ mode, boards: ["f635c1de"] }))).rejects.toThrow(resolver);
    }
    expect(readRows()).toEqual(before);
    expect(fs.existsSync(backupDir)).toBe(false);
  });

  it.each([
    ["two repositories", ["/repos/topbi", "/repos/routa"], 0],
    ["no repository", [], 0],
    ["the same repository twice", ["/repos/routa", "/repos/routa"], 1],
  ])("C4 workspace with %s", async (_label, repos, calls) => {
    const db = new BetterSqlite3(dbPath);
    db.prepare("DELETE FROM codebases WHERE workspace_id = 'ws-5'").run();
    repos.forEach((repo, index) => db.prepare("INSERT INTO codebases VALUES (?, 'ws-5', ?)").run(`x-${index}`, repo));
    db.close();
    setStub("/repos/routa", standard("routa", "main-push", [REPORTER_ID, PUSHER_ID]));
    const before = readRows().get(DEFAULT_BOARD_ID)!;

    const check = await runConfigure(options({ mode: "check", boards: ["a754459a"] }));
    const applied = await runConfigure(options({ mode: "apply", boards: ["a754459a"] }));
    const after = columnsOf(readRows().get(DEFAULT_BOARD_ID)!);

    expect(stepIds(after, "todo")).toEqual(["kanban-todo-orchestrator", "kanban-contract-setter"]);
    expect(resolverCalls()).toHaveLength(calls * 2);
    if (calls === 0) {
      expect(JSON.stringify(stage(after, "done"))).toBe(JSON.stringify(stage(columnsOf(before), "done")));
      expect(flightLine(check.output, DEFAULT_BOARD_ID)).toContain(`Done 列不动：工作区有 ${repos.length} 个代码仓`);
      expect(applied.boards[0]!.flight?.skipReason).toBeDefined();
    } else {
      expect(stepIds(after, "done")).toEqual([REPORTER_ID, PUSHER_ID]);
      expect(resolverCalls()[0]).toEqual(["--repo", "/repos/routa", "--format", "json"]);
    }
  });

  it("C5 kept steps stay byte-for-byte, new ones come from the template, removed ones only show as removed", async () => {
    const pusher = { ...plainStep("main-pusher", "DEVELOPER", PUSHER_ID, "Main Pusher"), model: "gpt-6.1-sol", reasoningEffort: "high", enabled: true, custom: { a: 1 } };
    const reporter = { ...plainStep("done-reporter", "GATE", REPORTER_ID, "完成汇报员"), model: "claude-haiku-5-5", specialistLocale: "zh-CN", providerId: "dsh", note: "x" };
    setDoneSteps(LOCAL_TOOLS_BOARD_ID, [pusher, reporter]);
    setStub("/repos/local-tools", standard("local-tools", "main-push", [REPORTER_ID, PUSHER_ID]));
    await runConfigure(options({ mode: "apply", boards: ["f635c1de"] }));
    const reversed = doneOf(LOCAL_TOOLS_BOARD_ID).automation.steps as Step[];
    expect(reversed.map((step) => JSON.stringify(step))).toEqual([JSON.stringify(reporter), JSON.stringify(pusher)]);

    const porter = { ...plainStep("topbi-porter", "DEVELOPER", PORTER_ID, "TopBI 移植员"), model: "m", extra: [1] };
    setDoneSteps(DSH_BOARD_ID, [reporter, porter]);
    const check = await runConfigure(options({ mode: "check", boards: ["2c17ef3e"] }));
    const line = flightLine(check.output, DSH_BOARD_ID);
    expect(line).toContain(`Done → ${PUSHER_ID}, ${REPORTER_ID} | 有变化（移除 ${PORTER_ID}）`);
    expect(line.split(" | ").find((part) => part.startsWith("Done →"))).not.toContain(PORTER_ID);
    await runConfigure(options({ mode: "apply", boards: ["2c17ef3e"] }));
    const steps = doneOf(DSH_BOARD_ID).automation.steps as Step[];
    expect(steps[0]).toEqual({ ...MAIN_PUSHER_STEP });
    expect(JSON.stringify(steps[1])).toBe(JSON.stringify(reporter));
  });

  it("C6 --check prints project, registration, delivery, Done target and change per board without writing", async () => {
    setStub("/repos/turnilo", standard("turnilo", "none", [REPORTER_ID], false));
    const hash = sha256(dbPath);
    const result = await runConfigure(options({ mode: "check", boards: ["312b1f5a", "d13eba6a", "f635c1de", "a754459a"] }));

    expect(result.exitCode).toBe(0);
    expect(sha256(dbPath)).toBe(hash);
    expect(flightLine(result.output, TOPBI_BOARD_ID)).toBe(
      `  flight: 312b1f5a TopBI Board | 项目 topbi | 已登记 | 交付 port-dev-alpha | Done → ${PORTER_ID}, ${REPORTER_ID} | 有变化`,
    );
    expect(flightLine(result.output, TURNILO_BOARD_ID)).toBe(
      `  flight: d13eba6a turnilo Board | 项目 turnilo | 项目未登记 | 交付 none | Done → ${REPORTER_ID} | 有变化（移除 ${PUSHER_ID}）`,
    );
    expect(flightLine(result.output, LOCAL_TOOLS_BOARD_ID)).toContain(`交付 main-push | Done → ${PUSHER_ID}, ${REPORTER_ID} | 无变化`);
    expect(flightLine(result.output, DEFAULT_BOARD_ID)).toContain("Done 列不动：工作区有 2 个代码仓（/repos/routa, /repos/topbi）");
  });

  it("C7 resolver path comes from FLIGHT_RESOLVE, else <HOME>/Desktop/my/knowledge-system/tools/flight_resolve.py", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "flight-home-"));
    try {
      const hash = sha256(dbPath);
      const expected = path.join(home, "Desktop/my/knowledge-system/tools/flight_resolve.py");
      await expect(runConfigure(options({ mode: "apply", boards: ["f635c1de"] }), { env: { HOME: home } })).rejects.toThrow(expected);
      await expect(runConfigure(options({ mode: "check", boards: ["f635c1de"] }), { env: { HOME: home, FLIGHT_RESOLVE: "  " } })).rejects.toThrow(expected);
      expect(sha256(dbPath)).toBe(hash);
      expect(resolverCalls()).toEqual([]);

      await runConfigure(options({ mode: "check", boards: ["f635c1de"] }), { env: { HOME: home, FLIGHT_RESOLVE: resolver } });
      expect(resolverCalls()).toHaveLength(1);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("C14 empty done_steps empties the Done column and --check says so", async () => {
    setStub("/repos/local-tools", standard("local-tools", "none", []));
    const check = await runConfigure(options({ mode: "check", boards: ["f635c1de"] }));
    expect(flightLine(check.output, LOCAL_TOOLS_BOARD_ID)).toContain("Done →（空） | 有变化");
    await runConfigure(options({ mode: "apply", boards: ["f635c1de"] }));
    expect(doneOf(LOCAL_TOOLS_BOARD_ID).automation.steps).toEqual([]);
    expect(doneOf(LOCAL_TOOLS_BOARD_ID).automation).not.toHaveProperty("specialistId");
  });

  it("F2 the six real board shapes: a second --apply changes nothing, Default Done stays, rollback restores bytes", async () => {
    const before = readRows();
    const all = ALL_BOARD_IDS.map((id) => id.slice(0, 8));
    const first = await runConfigure(options({ mode: "apply", boards: all, allowRoutaBoard: true }), { now: new Date("2026-10-26T08:00:00.000Z") });
    const configured = readRows();
    expect(stepIds(columnsOf(configured.get(TOPBI_BOARD_ID)!), "done")).toEqual(PORT);
    for (const id of [LOCAL_TOOLS_BOARD_ID, DSH_BOARD_ID, TURNILO_BOARD_ID, ROUTA_BOARD_ID, DEFAULT_BOARD_ID]) {
      expect(JSON.stringify(stage(columnsOf(configured.get(id)!), "done")), id).toBe(JSON.stringify(stage(columnsOf(before.get(id)!), "done")));
    }

    const hash = sha256(dbPath);
    const check = await runConfigure(options({ mode: "check", boards: all, allowRoutaBoard: true }));
    for (const id of ALL_BOARD_IDS.filter((entry) => entry !== DEFAULT_BOARD_ID)) expect(flightLine(check.output, id), id).toMatch(/\| 无变化$/);
    expect(flightLine(check.output, DEFAULT_BOARD_ID)).toContain("Done 列不动");
    const second = await runConfigure(options({ mode: "apply", boards: all, allowRoutaBoard: true }), { now: new Date("2026-10-26T09:00:00.000Z") });
    expect(second.backupPath).toBeUndefined();
    expect(sha256(dbPath)).toBe(hash);

    await runConfigure(options({ mode: "rollback", rollbackFile: first.backupPath, boards: all, allowRoutaBoard: true }));
    expect(readRows()).toEqual(before);
  });
});

describe("F3 random cross-check of the Done column against an independent reference", () => {
  const extraFields = ["model", "reasoningEffort", "enabled", "custom", "providerId", "specialistLocale"];

  function mulberry32(seed: number): () => number {
    let a = seed;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Written from the card, not from the implementation. */
  function reference(original: Step[], doneSteps: string[] | null): Step[] | "error" {
    if (doneSteps === null) return original;
    const allowed = [PORTER_ID, PUSHER_ID, REPORTER_ID];
    if (doneSteps.some((id) => !allowed.includes(id))) return "error";
    const reporter = original.find((step) => step.specialistId === REPORTER_ID)!;
    return doneSteps.map((id) => {
      const kept = original.find((step) => step.specialistId === id);
      if (kept) return kept;
      if (id === PUSHER_ID) return { id: "main-pusher", role: "DEVELOPER", specialistId: PUSHER_ID, specialistName: "Main Pusher" };
      const porter: Step = { id: "topbi-porter", role: "DEVELOPER", specialistId: PORTER_ID };
      porter.specialistName = String(reporter.specialistLocale ?? "").startsWith("zh") ? "TopBI 移植员" : "TopBI Porter";
      for (const field of ["providerId", "model", "reasoningEffort", "specialistLocale", "transport"]) {
        if (reporter[field] !== undefined) porter[field] = reporter[field];
      }
      return porter;
    });
  }

  it("matches the reference on 10,000 random Done columns × done_steps × repository counts", () => {
    const random = mulberry32(20261026);
    const pick = <T,>(items: T[]) => items[Math.floor(random() * items.length)]!;
    const shuffle = <T,>(items: T[]) => items.map((item) => [random(), item] as const).sort((a, b) => a[0] - b[0]).map(([, item]) => item);
    const withExtras = (step: Step): Step => {
      const copy = { ...step };
      for (const field of extraFields) if (random() < 0.3) copy[field] = field === "specialistLocale" ? pick(["zh-CN", "en"]) : `${field}-${Math.floor(random() * 9)}`;
      return copy;
    };
    let errors = 0;
    let changed = 0;
    for (let index = 0; index < 10_000; index += 1) {
      const pool = [plainStep("topbi-porter", "DEVELOPER", PORTER_ID, "TopBI Porter"), plainStep("main-pusher", "DEVELOPER", PUSHER_ID, "Main Pusher"), plainStep("custom", "GATE", "kanban-custom", "Custom")];
      const original = shuffle([...pool.filter(() => random() < 0.5), plainStep("done-reporter", "GATE", REPORTER_ID, "Done Reporter")]).map(withExtras);
      const doneSteps = shuffle([PORTER_ID, PUSHER_ID, REPORTER_ID].filter(() => random() < 0.6));
      if (random() < 0.1) doneSteps.splice(Math.floor(random() * (doneSteps.length + 1)), 0, "kanban-unregistered");
      const repoCount = pick([0, 1, 1, 1, 2]);
      const columns = plainColumns().map((entry) => (entry.stage === "done" ? column("done", 4, original) : entry));
      const snapshot = JSON.stringify(columns);
      const expected = reference(original, repoCount === 1 ? doneSteps : null);

      let actual: Step[] | "error";
      try {
        actual = stage(withFlightChecklist(columns, LOCAL_TOOLS_BOARD_ID, repoCount === 1 ? doneSteps : null) as Column[], "done").automation.steps as Step[];
      } catch {
        actual = "error";
      }
      expect(JSON.stringify(columns), `input mutated #${index}`).toBe(snapshot);
      expect(JSON.stringify(actual), `case #${index} ${JSON.stringify({ original, doneSteps, repoCount })}`).toBe(JSON.stringify(expected));
      if (actual === "error") errors += 1;
      else if (JSON.stringify(actual) !== JSON.stringify(original)) changed += 1;
    }
    expect(errors).toBeGreaterThan(500);
    expect(changed).toBeGreaterThan(3000);
  });
});
