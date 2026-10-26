// @vitest-environment node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CONTRACT_SETTER_ID,
  DESIGNER_ID,
  TODO_ORCHESTRATOR_ID,
  parseArgs,
  runConfigureDesigner,
  withDesignerStep,
  type Column,
  type Options,
  type Step,
} from "../kanban/configure-designer";

const QA_ID = "kanban-qa-frontend";

function step(specialistId: string, extra: Record<string, unknown> = {}): Step {
  return { id: specialistId.replace(/^kanban-/, ""), role: "CRAFTER", specialistId, specialistName: specialistId, ...extra };
}

function column(stage: string, steps: Step[] | undefined, extra: Record<string, unknown> = {}): Column {
  return {
    id: stage,
    name: stage === "todo" ? "Todo" : stage,
    stage,
    automation: steps === undefined ? { enabled: true } : { enabled: true, steps, transitionType: "entry", ...extra },
  };
}

function board(todoSteps: Step[] | undefined): Column[] {
  return [
    column("backlog", [step("kanban-backlog-refiner")]),
    column("todo", todoSteps, { contractRules: { requireCanonicalStory: true } }),
    column("dev", [step("kanban-dev-executor")]),
    column("review", [step(QA_ID), step("kanban-review-guard")]),
  ];
}

function todoIds(columns: Column[]): string[] {
  return (columns.find((entry) => entry.stage === "todo")?.automation?.steps ?? []).map((entry) => entry.specialistId ?? "?");
}

const ORCHESTRATOR = step(TODO_ORCHESTRATOR_ID, {
  providerId: "dsh",
  model: "claude-opus-5-5",
  reasoningEffort: "high",
  specialistLocale: "zh-CN",
  transport: "acp",
});
const SETTER = step(CONTRACT_SETTER_ID, { providerId: "dsh" });
const OTHER = step("kanban-knowledge-reviewer");

describe("withDesignerStep (C4)", () => {
  it("inserts the designer before the contract setter: [orchestrator, setter]", () => {
    const columns = board([ORCHESTRATOR, SETTER]);
    const next = withDesignerStep(columns);
    expect(todoIds(next)).toEqual([TODO_ORCHESTRATOR_ID, DESIGNER_ID, CONTRACT_SETTER_ID]);
    const designer = next[1]!.automation!.steps![1]!;
    expect(designer).toEqual({
      id: "designer",
      role: "CRAFTER",
      specialistId: DESIGNER_ID,
      specialistName: "设计师",
      providerId: "dsh",
      model: "claude-opus-5-5",
      reasoningEffort: "high",
      specialistLocale: "zh-CN",
      transport: "acp",
    });
    // Other columns and the Todo column's other fields stay as they were.
    for (const index of [0, 2, 3]) expect(next[index]).toEqual(columns[index]);
    expect(next[1]!.automation!.contractRules).toEqual({ requireCanonicalStory: true });
  });

  it("follows the orchestrator directly when there is no contract setter", () => {
    const plain = step(TODO_ORCHESTRATOR_ID);
    const next = withDesignerStep(board([plain]));
    expect(todoIds(next)).toEqual([TODO_ORCHESTRATOR_ID, DESIGNER_ID]);
    expect(next[1]!.automation!.steps![1]!.specialistName).toBe("Designer");
    expect(next[1]!.automation!.steps![1]!).not.toHaveProperty("providerId");
  });

  it("goes right before the setter and keeps the other steps in order: [orchestrator, other, setter]", () => {
    const next = withDesignerStep(board([ORCHESTRATOR, OTHER, SETTER]));
    expect(todoIds(next)).toEqual([TODO_ORCHESTRATOR_ID, OTHER.specialistId, DESIGNER_ID, CONTRACT_SETTER_ID]);
  });

  it.each([
    ["designer already mounted", board([ORCHESTRATOR, step(DESIGNER_ID), SETTER])],
    ["Todo column without the orchestrator", board([step("kanban-other"), SETTER])],
    ["no Todo column", board([ORCHESTRATOR, SETTER]).filter((entry) => entry.stage !== "todo")],
    ["empty steps", board([])],
    ["automation without steps", board(undefined)],
  ])("returns the input unchanged: %s", (_label, columns) => {
    const snapshot = structuredClone(columns);
    const next = withDesignerStep(columns);
    expect(next).toEqual(snapshot);
    expect(columns).toEqual(snapshot);
  });

  it("is idempotent", () => {
    const once = withDesignerStep(board([ORCHESTRATOR, SETTER]));
    expect(withDesignerStep(once)).toEqual(once);
  });
});

// ---- F3: 10,000 random Todo columns judged by an independent reading of the requirement ----

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const POOL = [TODO_ORCHESTRATOR_ID, CONTRACT_SETTER_ID, DESIGNER_ID, "kanban-knowledge-reviewer", "kanban-other", "kanban-x"];

function randomBoard(random: () => number): Column[] {
  const steps = Array.from({ length: Math.floor(random() * 6) }, (_, i) =>
    step(POOL[Math.floor(random() * POOL.length)]!, { n: i, specialistLocale: random() < 0.5 ? "zh-CN" : undefined }),
  );
  const columns: Column[] = [column("backlog", [step(TODO_ORCHESTRATOR_ID)])];
  if (random() < 0.9) columns.push(column("todo", steps));
  columns.push(column("dev", [step(CONTRACT_SETTER_ID)]));
  return columns;
}

/** Judge written from the requirement, not from the implementation. Returns a list of violations. */
function judge(input: Column[], output: Column[], acceptAfterSetter = false): string[] {
  const problems: string[] = [];
  if (output.length !== input.length) return ["column count changed"];
  input.forEach((before, index) => {
    const after = output[index]!;
    if (before.stage !== "todo") {
      if (JSON.stringify(after) !== JSON.stringify(before)) problems.push(`non-Todo column ${before.stage} changed`);
      return;
    }
    const ids = (before.automation?.steps ?? []).map((entry) => entry.specialistId);
    const outIds = (after.automation?.steps ?? []).map((entry) => entry.specialistId);
    const needs = ids.includes(TODO_ORCHESTRATOR_ID) && !ids.includes(DESIGNER_ID);
    if (!needs) {
      if (JSON.stringify(after) !== JSON.stringify(before)) problems.push("Todo column changed although no insert was due");
      return;
    }
    const designers = outIds.flatMap((id, i) => (id === DESIGNER_ID ? [i] : []));
    if (designers.length !== 1) return problems.push(`expected exactly one designer, got ${designers.length}`);
    const at = designers[0]!;
    const rest = outIds.filter((_, i) => i !== at);
    if (JSON.stringify(rest) !== JSON.stringify(ids)) problems.push("other steps changed order");
    const orch = ids.indexOf(TODO_ORCHESTRATOR_ID);
    const setterAfter = ids.findIndex((id, i) => i > orch && id === CONTRACT_SETTER_ID);
    // Expected position in the output: right before that setter, or right after the orchestrator.
    const expected = setterAfter >= 0 ? setterAfter : orch + 1;
    const allowed = acceptAfterSetter && setterAfter >= 0 ? [expected, expected + 1] : [expected];
    if (!allowed.includes(at)) problems.push(`designer at ${at}, expected ${expected} in [${ids.join(",")}]`);
  });
  return problems;
}

describe("withDesignerStep random cross-check (F3)", () => {
  it("passes 10,000 random boards and stays idempotent", () => {
    const random = mulberry32(20261026);
    let inserted = 0;
    for (let i = 0; i < 10_000; i += 1) {
      const input = randomBoard(random);
      const snapshot = JSON.stringify(input);
      const output = withDesignerStep(input);
      expect(JSON.stringify(input), `input mutated #${i}`).toBe(snapshot);
      const problems = judge(input, output);
      expect(problems, `case ${i}: ${snapshot}`).toEqual([]);
      expect(withDesignerStep(output), `not idempotent #${i}`).toEqual(output);
      if (JSON.stringify(output) !== snapshot) inserted += 1;
    }
    expect(inserted).toBeGreaterThan(1000);
  });

  it("catches a planted wrong implementation (designer after the setter)", () => {
    const wrong = (columns: Column[]): Column[] =>
      withDesignerStep(columns).map((entry) => {
        const steps = entry.automation?.steps;
        if (entry.stage !== "todo" || !steps) return entry;
        const at = steps.findIndex((s) => s.specialistId === DESIGNER_ID);
        if (at < 0 || steps[at + 1]?.specialistId !== CONTRACT_SETTER_ID) return entry;
        const swapped = [...steps];
        [swapped[at], swapped[at + 1]] = [swapped[at + 1]!, swapped[at]!];
        return { ...entry, automation: { ...entry.automation, steps: swapped } };
      });
    const input = board([ORCHESTRATOR, SETTER]);
    expect(judge(input, wrong(input)).length).toBeGreaterThan(0);
    // A judge that also accepts "after the setter" would let the wrong implementation through.
    expect(judge(input, wrong(input), true)).toEqual([]);
  });
});

// ---- Script runs on a temporary SQLite file; the real routa.db is never opened ----

let tempDir: string;
let dbPath: string;
let backupDir: string;
const BOARD_A = "aaaaaaaa-0000-4000-8000-000000000001"; // orchestrator + setter
const BOARD_B = "bbbbbbbb-0000-4000-8000-000000000002"; // orchestrator only
const BOARD_C = "cccccccc-0000-4000-8000-000000000003"; // no orchestrator
const CREATED = 1_700_000_000_000;

function sha256(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function rows(): Map<string, { columns: string; updated_at: number }> {
  const db = new BetterSqlite3(dbPath, { readonly: true });
  try {
    const all = db.prepare("SELECT id, columns, updated_at FROM kanban_boards").all() as Array<{ id: string; columns: string; updated_at: number }>;
    return new Map(all.map((row) => [row.id, row]));
  } finally {
    db.close();
  }
}

function okFetch(calls: string[] = []): typeof fetch {
  return (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
}

function options(extra: Partial<Options> = {}): Options {
  return { dbPath, dryRun: false, baseUrl: "http://routa.test", backupDir, ...extra };
}

function backups(): string[] {
  return fs.existsSync(backupDir) ? fs.readdirSync(backupDir) : [];
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "configure-designer-"));
  dbPath = path.join(tempDir, "routa.db");
  backupDir = path.join(tempDir, "backups");
  const db = new BetterSqlite3(dbPath);
  db.exec(`CREATE TABLE kanban_boards (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL,
      columns TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
  const insert = db.prepare("INSERT INTO kanban_boards VALUES (?, 'ws', ?, ?, ?, ?)");
  insert.run(BOARD_A, "TopBI Board", JSON.stringify(board([ORCHESTRATOR, SETTER])), CREATED, CREATED + 1);
  insert.run(BOARD_B, "Default Workspace Board", JSON.stringify(board([step(TODO_ORCHESTRATOR_ID)])), CREATED, CREATED + 2);
  insert.run(BOARD_C, "Other Board", JSON.stringify(board([step("kanban-other")])), CREATED, CREATED + 3);
  db.close();
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("configure-designer script", () => {
  it("parses arguments", () => {
    expect(parseArgs(["--db", "x.db", "--dry-run"])).toEqual({ dbPath: "x.db", dryRun: true, baseUrl: "http://127.0.0.1:3000", backupDir: undefined });
    expect(() => parseArgs(["--dry-run"])).toThrow("--db");
    expect(() => parseArgs(["--db", "x.db", "--boards", "a"])).toThrow("Unknown argument");
  });

  it.each([
    ["404", async () => new Response("", { status: 404 })],
    ["500", async () => new Response("", { status: 500 })],
    ["network error", async () => { throw new TypeError("fetch failed"); }],
  ])("exits 3 and writes nothing when the probe returns %s (C5)", async (_label, impl) => {
    const hash = sha256(dbPath);
    for (const dryRun of [false, true]) {
      const result = await runConfigureDesigner(options({ dryRun }), { fetchImpl: impl as unknown as typeof fetch });
      expect(result.exitCode).toBe(3);
      expect(result.changes).toEqual([]);
      expect(result.output).toContain("未写库");
    }
    expect(sha256(dbPath)).toBe(hash);
    expect(backups()).toEqual([]);
  });

  it("probes /api/specialists?id=kanban-designer", async () => {
    const calls: string[] = [];
    await runConfigureDesigner(options({ dryRun: true, baseUrl: "http://routa.test/" }), { fetchImpl: okFetch(calls) });
    expect(calls).toEqual(["http://routa.test/api/specialists?id=kanban-designer"]);
  });

  it("--dry-run prints the boards and columns to change and writes nothing (C5, F4)", async () => {
    const hash = sha256(dbPath);
    const result = await runConfigureDesigner(options({ dryRun: true }), { fetchImpl: okFetch() });
    expect(result.exitCode).toBe(0);
    expect(result.changes.map((change) => change.id)).toEqual([BOARD_A, BOARD_B]);
    expect(result.output).toContain("dry run, nothing written");
    expect(result.output).toContain(`${BOARD_A}  TopBI Board | column Todo | [${TODO_ORCHESTRATOR_ID}, ${CONTRACT_SETTER_ID}] -> [${TODO_ORCHESTRATOR_ID}, ${DESIGNER_ID}, ${CONTRACT_SETTER_ID}]`);
    expect(result.output).toContain(`${BOARD_B}  Default Workspace Board | column Todo`);
    expect(result.output).not.toContain(BOARD_C);
    expect(sha256(dbPath)).toBe(hash);
    expect(backups()).toEqual([]);
  });

  it("mounts the designer on matching boards, backs up first, and is idempotent (C6, F4)", async () => {
    const before = rows();
    const now = new Date("2026-10-26T12:00:00.000Z");
    const first = await runConfigureDesigner(options(), { fetchImpl: okFetch(), now });
    expect(first.exitCode).toBe(0);
    expect(first.changes.map((change) => change.id)).toEqual([BOARD_A, BOARD_B]);

    const after = rows();
    expect(todoIds(JSON.parse(after.get(BOARD_A)!.columns))).toEqual([TODO_ORCHESTRATOR_ID, DESIGNER_ID, CONTRACT_SETTER_ID]);
    expect(todoIds(JSON.parse(after.get(BOARD_B)!.columns))).toEqual([TODO_ORCHESTRATOR_ID, DESIGNER_ID]);
    expect(after.get(BOARD_A)!.updated_at).toBe(now.getTime());
    expect(after.get(BOARD_C)).toEqual(before.get(BOARD_C));

    expect(first.backupPath).toBeDefined();
    const backup = JSON.parse(fs.readFileSync(first.backupPath!, "utf8"));
    expect(backup.boards.map((entry: { id: string }) => entry.id)).toEqual([BOARD_A, BOARD_B]);
    expect(backup.boards[0].columns).toBe(before.get(BOARD_A)!.columns);

    const hash = sha256(dbPath);
    const second = await runConfigureDesigner(options(), { fetchImpl: okFetch(), now: new Date("2026-10-26T13:00:00.000Z") });
    expect(second.exitCode).toBe(0);
    expect(second.changes).toEqual([]);
    expect(second.backupPath).toBeUndefined();
    expect(sha256(dbPath)).toBe(hash);
    expect(rows()).toEqual(after);
    expect(backups()).toHaveLength(1);
  });

  it("refuses a board with broken JSON and writes nothing (C15)", async () => {
    const db = new BetterSqlite3(dbPath);
    db.prepare("UPDATE kanban_boards SET columns = ? WHERE id = ?").run("[{oops", BOARD_C);
    db.close();
    const hash = sha256(dbPath);
    await expect(runConfigureDesigner(options(), { fetchImpl: okFetch() })).rejects.toThrow(BOARD_C);
    expect(sha256(dbPath)).toBe(hash);
    expect(backups()).toEqual([]);
  });

  it("only touches the temporary database", () => {
    expect(dbPath.startsWith(os.tmpdir())).toBe(true);
    expect(path.basename(path.dirname(dbPath))).toMatch(/^configure-designer-/);
  });
});
