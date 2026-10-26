/**
 * Mount the flight checklist specialists on the boards listed in --boards.
 *
 *   todo   : [<original todo-orchestrator>, kanban-contract-setter]
 *   dev    : kanban-dev-executor → kanban-flight-dev-executor
 *   review : [<original qa-frontend>, kanban-flight-review-guard (replaces kanban-review-guard), kanban-high-risk-reviewer]
 *   done   : steps in the order of `done_steps` printed by flight_resolve.py --repo <repo> --format json
 *            (the board's workspace must have exactly one codebase, otherwise the Done column is left as is)
 *
 * Usage:
 *   node --import tsx scripts/kanban/configure-flight-checklist.ts --db <path> --boards <id,...> --check
 *   node --import tsx scripts/kanban/configure-flight-checklist.ts --db <path> --boards <id,...> --apply [--backup-dir <dir>] [--base-url <url>]
 *   node --import tsx scripts/kanban/configure-flight-checklist.ts --db <path> --boards <id,...> --rollback <backup.json> [--force]
 *
 * --boards is required (full ids or 8-char prefixes). The Routa Board is refused
 * unless --allow-routa-board is given. Before --apply, every new specialist id is
 * probed with GET <base>/api/specialists?id=<id>; Routa caches specialist files per
 * process, so a 404 means Routa must be restarted first (exit code 3, nothing written).
 * The resolver path comes from FLIGHT_RESOLVE (default ~/Desktop/my/knowledge-system/tools/flight_resolve.py).
 * Every board is resolved and validated before anything is written; a resolver failure or a done_steps id
 * missing from DONE_STEP_TEMPLATES aborts the whole run (exit 1, nothing written).
 * Exit codes: 0 ok / read-only check, 1 argument or data error, 3 probe failed.
 * See docs/operational/kanban-flight-checklist.zh-CN.md.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";
import BetterSqlite3 from "better-sqlite3";
import { MAIN_PUSHER_STEP } from "./configure-done-main-pusher";

export const ROUTA_BOARD_ID = "361d06fd-6478-4995-9b6e-ab0b0b271471";
export const DEFAULT_RESOLVER = "Desktop/my/knowledge-system/tools/flight_resolve.py";
const RESOLVER_TIMEOUT_MS = 60_000;
export const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
export const PROBE_FAILURE_MESSAGE =
  "Routa 进程还没加载新岗位文件（岗位文件按进程缓存，要重启 Routa 才读到）";

interface StepTemplate {
  id: string;
  role: string;
  specialistId: string;
  name: { en: string; zh: string };
}

const CONTRACT_SETTER: StepTemplate = {
  id: "contract-setter",
  role: "CRAFTER",
  specialistId: "kanban-contract-setter",
  name: { en: "Contract Setter", zh: "出题人" },
};
const FLIGHT_DEV_EXECUTOR: StepTemplate = {
  id: "flight-dev-executor",
  role: "CRAFTER",
  specialistId: "kanban-flight-dev-executor",
  name: { en: "Flight Dev Crafter", zh: "开发执行员（起飞检查单）" },
};
const FLIGHT_REVIEW_GUARD: StepTemplate = {
  id: "flight-review-guard",
  role: "GATE",
  specialistId: "kanban-flight-review-guard",
  name: { en: "Flight Review Guard", zh: "评审守卫（起飞检查单）" },
};
const HIGH_RISK_REVIEWER: StepTemplate = {
  id: "high-risk-reviewer",
  role: "GATE",
  specialistId: "kanban-high-risk-reviewer",
  name: { en: "High-Risk Reviewer", zh: "高风险复核员" },
};
const TOPBI_PORTER: StepTemplate = {
  id: "topbi-porter",
  role: "DEVELOPER",
  specialistId: "kanban-topbi-porter",
  name: { en: "TopBI Porter", zh: "TopBI 移植员" },
};

/**
 * The single registry of Done-lane steps that flight_resolve.py's done_steps may ask for.
 * kanban-done-reporter is not built from a template: the column's existing reporter step is kept.
 */
interface DoneStepTemplate {
  why: string;
  build: (source: Step) => Step;
}

export const DONE_STEP_TEMPLATES: Readonly<Record<string, DoneStepTemplate>> = {
  "kanban-topbi-porter": {
    why: "port-dev-alpha delivery (TopBI): port the change to the dev/alpha branches instead of pushing main",
    build: (source) => buildStep(TOPBI_PORTER, source),
  },
  "kanban-main-pusher": {
    why: "main-push delivery: rebase, re-run verification and push to origin main (same step as configure-done-main-pusher)",
    build: () => ({ ...MAIN_PUSHER_STEP }),
  },
};

const TODO_ORCHESTRATOR_ID = "kanban-todo-orchestrator";
const DEV_EXECUTOR_ID = "kanban-dev-executor";
const QA_FRONTEND_ID = "kanban-qa-frontend";
const REVIEW_GUARD_ID = "kanban-review-guard";
const DONE_REPORTER_ID = "kanban-done-reporter";

/** Runtime fields copied from the replaced (or neighbouring) step onto the new step. */
const CARRIED_FIELDS = ["providerId", "model", "reasoningEffort", "specialistLocale", "transport"] as const;

export const BASE_SPECIALIST_IDS = [
  CONTRACT_SETTER.specialistId,
  FLIGHT_DEV_EXECUTOR.specialistId,
  FLIGHT_REVIEW_GUARD.specialistId,
  HIGH_RISK_REVIEWER.specialistId,
];

export type Mode = "check" | "apply" | "rollback";

export interface Options {
  dbPath: string;
  mode: Mode;
  boards: string[];
  baseUrl: string;
  backupDir?: string;
  rollbackFile?: string;
  allowRoutaBoard: boolean;
  force: boolean;
}

interface Step {
  id?: string;
  role?: string;
  specialistId?: string;
  specialistName?: string;
  [key: string]: unknown;
}

interface Column {
  id?: string;
  stage?: string;
  automation?: { steps?: Step[]; [key: string]: unknown };
  [key: string]: unknown;
}

interface BoardRow {
  id: string;
  workspace_id: string;
  name: string;
  columns: string;
  updated_at: number;
}

type StageSteps = Record<"todo" | "dev" | "review" | "done", string[]>;

/** What flight_resolve.py said about a board's repository (or why the Done column is left alone). */
export interface FlightInfo {
  repos: string[];
  skipReason?: string;
  project?: string;
  registered?: boolean;
  delivery?: string;
  doneSteps?: string[];
  doneChanged: boolean;
  removed: string[];
}

export interface BoardReport {
  id: string;
  name: string;
  before: StageSteps;
  after: StageSteps;
  changed: boolean;
  flight?: FlightInfo;
}

export interface ProbeResult {
  id: string;
  status: number | "unreachable";
}

export interface RunResult {
  mode: Mode;
  exitCode: 0 | 3;
  boards: BoardReport[];
  probes: ProbeResult[];
  backupPath?: string;
  message?: string;
  output: string;
}

export interface BackupFile {
  createdAt: string;
  boards: Array<{ id: string; name: string; columns: string; updated_at: number; newColumns: string }>;
}

export function parseArgs(argv: string[]): Options {
  let dbPath: string | undefined;
  let backupDir: string | undefined;
  let rollbackFile: string | undefined;
  let boardsArg: string | undefined;
  let baseUrl = DEFAULT_BASE_URL;
  let allowRoutaBoard = false;
  let force = false;
  const modes: Mode[] = [];

  const value = (index: number, flag: string): string => {
    const next = argv[index];
    if (next === undefined || next.startsWith("--")) throw new Error(`${flag} needs a value`);
    return next;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--db") dbPath = value(++index, arg);
    else if (arg === "--backup-dir") backupDir = value(++index, arg);
    else if (arg === "--boards") boardsArg = value(++index, arg);
    else if (arg === "--base-url") baseUrl = value(++index, arg);
    else if (arg === "--check") modes.push("check");
    else if (arg === "--apply") modes.push("apply");
    else if (arg === "--rollback") {
      modes.push("rollback");
      rollbackFile = value(++index, arg);
    } else if (arg === "--allow-routa-board") allowRoutaBoard = true;
    else if (arg === "--force") force = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!dbPath) throw new Error("--db <path> is required");
  if (modes.length !== 1) throw new Error("Pass exactly one of --check, --apply or --rollback <backup file>");
  const boards = (boardsArg ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  if (boards.length === 0) throw new Error("--boards <id,id,...> is required (full ids or 8-char prefixes)");
  return { dbPath, mode: modes[0]!, boards, baseUrl, backupDir, rollbackFile, allowRoutaBoard, force };
}

function isChineseLocale(step: Step): boolean {
  return typeof step.specialistLocale === "string" && step.specialistLocale.toLowerCase().startsWith("zh");
}

function buildStep(template: StepTemplate, source: Step): Step {
  const step: Step = {
    id: template.id,
    role: template.role,
    specialistId: template.specialistId,
    specialistName: isChineseLocale(source) ? template.name.zh : template.name.en,
  };
  for (const field of CARRIED_FIELDS) {
    if (source[field] !== undefined) step[field] = source[field];
  }
  return step;
}

function stepsOf(column: Column): Step[] {
  return column.automation?.steps ?? [];
}

function requireStep(column: Column, specialistId: string, boardId: string): Step {
  const step = stepsOf(column).find((entry) => entry.specialistId === specialistId);
  if (!step) {
    throw new Error(`Board ${boardId}: ${column.stage} column has no ${specialistId} step; refusing to guess`);
  }
  return step;
}

function withSteps(column: Column, steps: Step[]): Column {
  // The board's primary-step fields mirror steps[0] (normalizeKanbanAutomation).
  const first = steps[0];
  if (!first) {
    const { role: _role, specialistId: _id, specialistName: _name, ...automation } = column.automation ?? {};
    return { ...column, automation: { ...automation, steps: [] } };
  }
  return {
    ...column,
    automation: {
      ...column.automation,
      steps,
      role: first.role,
      specialistId: first.specialistId,
      specialistName: first.specialistName,
    },
  };
}

function hasStep(column: Column, specialistId: string): boolean {
  return stepsOf(column).some((entry) => entry.specialistId === specialistId);
}

/** Reject done_steps ids that have no template (positive allow-list) before anything is planned. */
export function checkDoneSteps(doneSteps: readonly string[], boardId: string): void {
  const unknown = doneSteps.filter((id) => id !== DONE_REPORTER_ID && !Object.hasOwn(DONE_STEP_TEMPLATES, id));
  if (unknown.length > 0) {
    throw new Error(
      `Board ${boardId}: done_steps has ids not registered in DONE_STEP_TEMPLATES: ${unknown.join(", ")} ` +
        `(registered: ${[...Object.keys(DONE_STEP_TEMPLATES), DONE_REPORTER_ID].join(", ")}); nothing written`,
    );
  }
  const duplicates = doneSteps.filter((id, index) => doneSteps.indexOf(id) !== index);
  if (duplicates.length > 0) throw new Error(`Board ${boardId}: done_steps repeats ${duplicates.join(", ")}; nothing written`);
}

/** Done column in done_steps order: existing steps with the same specialistId are kept as they are. */
function withDoneSteps(column: Column, boardId: string, doneSteps: readonly string[]): Column {
  checkDoneSteps(doneSteps, boardId);
  const existing = stepsOf(column);
  const source = existing.find((step) => step.specialistId === DONE_REPORTER_ID) ?? existing[0] ?? {};
  const steps = doneSteps.map((id) => {
    const kept = existing.find((step) => step.specialistId === id);
    if (kept) return kept;
    if (id === DONE_REPORTER_ID) return requireStep(column, id, boardId);
    return DONE_STEP_TEMPLATES[id]!.build(source);
  });
  if (isDeepStrictEqual(steps, existing)) return column;
  return withSteps(column, steps);
}

/**
 * Return columns with the flight checklist mounted; already-mounted columns are left as they are.
 * doneSteps null leaves the Done column untouched (the workspace does not map to exactly one repository).
 */
export function withFlightChecklist(columns: Column[], boardId: string, doneSteps: readonly string[] | null = null): Column[] {
  for (const stage of ["todo", "dev", "review"]) {
    if (!columns.some((column) => column.stage === stage)) throw new Error(`Board ${boardId}: no ${stage} column`);
  }
  return columns.map((column) => {
    switch (column.stage) {
      case "todo": {
        if (hasStep(column, CONTRACT_SETTER.specialistId)) return column;
        const orchestrator = requireStep(column, TODO_ORCHESTRATOR_ID, boardId);
        return withSteps(column, [orchestrator, buildStep(CONTRACT_SETTER, orchestrator)]);
      }
      case "dev": {
        if (hasStep(column, FLIGHT_DEV_EXECUTOR.specialistId)) return column;
        requireStep(column, DEV_EXECUTOR_ID, boardId);
        return withSteps(
          column,
          stepsOf(column).map((step) => (step.specialistId === DEV_EXECUTOR_ID ? buildStep(FLIGHT_DEV_EXECUTOR, step) : step)),
        );
      }
      case "review": {
        if (hasStep(column, FLIGHT_REVIEW_GUARD.specialistId) && hasStep(column, HIGH_RISK_REVIEWER.specialistId)) return column;
        const qa = requireStep(column, QA_FRONTEND_ID, boardId);
        const guard = requireStep(column, REVIEW_GUARD_ID, boardId);
        return withSteps(column, [qa, buildStep(FLIGHT_REVIEW_GUARD, guard), buildStep(HIGH_RISK_REVIEWER, guard)]);
      }
      case "done":
        return doneSteps === null ? column : withDoneSteps(column, boardId, doneSteps);
      default:
        return column;
    }
  });
}

function stageSteps(columns: Column[]): StageSteps {
  const ids = (stage: string) =>
    stepsOf(columns.find((column) => column.stage === stage) ?? {}).map(
      (step) => step.specialistId ?? step.specialistName ?? step.role ?? "unknown",
    );
  return { todo: ids("todo"), dev: ids("dev"), review: ids("review"), done: ids("done") };
}

function parseColumns(row: BoardRow): Column[] {
  const columns = JSON.parse(row.columns) as unknown;
  if (!Array.isArray(columns)) throw new Error(`Board ${row.id}: columns is not a JSON array`);
  return columns as Column[];
}

export function resolverPath(env: Record<string, string | undefined> = process.env): string {
  const home = env.HOME || os.homedir();
  const configured = env.FLIGHT_RESOLVE?.trim();
  if (!configured) return path.join(home, DEFAULT_RESOLVER);
  return configured.startsWith("~/") ? path.join(home, configured.slice(2)) : configured;
}

export interface FlightStandard {
  registered: boolean;
  project: string;
  delivery: string;
  doneSteps: string[];
}

/** Run `python3 <resolver> --repo <repo> --format json`; any failure throws so nothing gets written. */
export function resolveStandard(resolver: string, repoPath: string): FlightStandard {
  const command = `${resolver} --repo ${repoPath} --format json`;
  if (!fs.existsSync(resolver)) throw new Error(`flight_resolve.py not found: ${resolver} (set FLIGHT_RESOLVE); nothing written`);
  let stdout: string;
  try {
    stdout = execFileSync("python3", [resolver, "--repo", repoPath, "--format", "json"], {
      encoding: "utf8",
      timeout: RESOLVER_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = (error as { stderr?: string }).stderr?.trim() || (error instanceof Error ? error.message : String(error));
    throw new Error(`Resolver failed: ${command}: ${detail}; nothing written`, { cause: error });
  }
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    throw new Error(`Resolver did not print JSON: ${command}: ${stdout.slice(0, 200)}; nothing written`);
  }
  const doneSteps = data?.done_steps;
  if (!Array.isArray(doneSteps) || !doneSteps.every((id) => typeof id === "string")) {
    throw new Error(`Resolver output has no done_steps string array: ${command}; nothing written`);
  }
  return {
    registered: data.registered === true,
    project: String(data.project ?? data.repo_key ?? "?"),
    delivery: String(data.delivery ?? "?"),
    doneSteps,
  };
}

function boardRepos(db: BetterSqlite3.Database, workspaceId: string): string[] {
  const rows = db.prepare("SELECT DISTINCT repo_path FROM codebases WHERE workspace_id = ? ORDER BY repo_path").all(workspaceId);
  return (rows as Array<{ repo_path: string }>).map((row) => row.repo_path);
}

function resolveBoards(db: BetterSqlite3.Database, requested: string[], allowRoutaBoard: boolean): BoardRow[] {
  const select = db.prepare("SELECT id, workspace_id, name, columns, updated_at FROM kanban_boards WHERE id LIKE ? || '%' ORDER BY id");
  const rows = new Map<string, BoardRow>();
  for (const prefix of requested) {
    if (!/^[0-9a-zA-Z-]+$/.test(prefix)) throw new Error(`Invalid board id: "${prefix}"`);
    const matches = select.all(prefix) as BoardRow[];
    if (matches.length === 0) throw new Error(`No board matches "${prefix}"`);
    if (matches.length > 1) throw new Error(`Board prefix "${prefix}" is ambiguous: ${matches.map((row) => row.id).join(", ")}`);
    rows.set(matches[0]!.id, matches[0]!);
  }
  if (rows.has(ROUTA_BOARD_ID) && !allowRoutaBoard) {
    throw new Error(`Routa Board ${ROUTA_BOARD_ID} is refused by default; pass --allow-routa-board to include it`);
  }
  return [...rows.values()];
}

function requiredSpecialistIds(planned: Planned[]): string[] {
  const ids = [...BASE_SPECIALIST_IDS];
  for (const { flight } of planned) {
    for (const id of flight.doneSteps ?? []) {
      if (Object.hasOwn(DONE_STEP_TEMPLATES, id) && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

async function probe(baseUrl: string, ids: string[]): Promise<ProbeResult[]> {
  const root = baseUrl.replace(/\/+$/, "");
  return Promise.all(
    ids.map(async (id): Promise<ProbeResult> => {
      try {
        const response = await fetch(`${root}/api/specialists?id=${encodeURIComponent(id)}`, {
          signal: AbortSignal.timeout(5000),
        });
        await response.body?.cancel();
        return { id, status: response.status };
      } catch {
        return { id, status: "unreachable" };
      }
    }),
  );
}

interface Planned {
  row: BoardRow;
  columns: Column[];
  next: Column[];
  changed: boolean;
  flight: FlightInfo;
}

function doneIds(columns: Column[]): string[] {
  return stageSteps(columns).done;
}

function plan(db: BetterSqlite3.Database, rows: BoardRow[], resolver: string): Planned[] {
  // Resolve and validate every board first; one failure aborts the run before anything is written.
  return rows.map((row) => {
    const repos = boardRepos(db, row.workspace_id);
    let standard: FlightStandard | undefined;
    if (repos.length === 1) {
      standard = resolveStandard(resolver, repos[0]!);
      checkDoneSteps(standard.doneSteps, row.id);
    }
    const columns = parseColumns(row);
    const next = withFlightChecklist(columns, row.id, standard ? standard.doneSteps : null);
    const doneBefore = columns.find((column) => column.stage === "done");
    const doneAfter = next.find((column) => column.stage === "done");
    const flight: FlightInfo = {
      repos,
      doneChanged: !isDeepStrictEqual(doneBefore, doneAfter),
      removed: doneIds(columns).filter((id) => !doneIds(next).includes(id)),
      ...(standard
        ? { project: standard.project, registered: standard.registered, delivery: standard.delivery, doneSteps: standard.doneSteps }
        : { skipReason: `工作区有 ${repos.length} 个代码仓` }),
    };
    return { row, columns, next, changed: !isDeepStrictEqual(columns, next), flight };
  });
}

export function formatFlightLine(board: Pick<BoardReport, "id" | "name" | "flight">): string {
  const head = `${board.id.slice(0, 8)} ${board.name}`;
  const flight = board.flight;
  if (!flight) return head;
  if (flight.skipReason) return `${head} | Done 列不动：${flight.skipReason}${flight.repos.length > 0 ? `（${flight.repos.join(", ")}）` : ""}`;
  const target = flight.doneSteps && flight.doneSteps.length > 0 ? ` ${flight.doneSteps.join(", ")}` : "（空）";
  const change = flight.doneChanged
    ? `有变化${flight.removed.length > 0 ? `（移除 ${flight.removed.join(", ")}）` : ""}`
    : "无变化";
  return [
    head,
    `项目 ${flight.project}`,
    flight.registered ? "已登记" : "项目未登记",
    `交付 ${flight.delivery}`,
    `Done →${target}`,
    change,
  ].join(" | ");
}

function formatOutput(mode: Mode, boards: BoardReport[], probes: ProbeResult[], extra: string[]): string {
  const lines: string[] = [];
  for (const board of boards) {
    lines.push(`${board.id}  ${board.name}${mode === "check" ? "" : board.changed ? "  (updated)" : "  (unchanged)"}`);
    if (board.flight) lines.push(`  flight: ${formatFlightLine(board)}`);
    for (const stage of ["todo", "dev", "review", "done"] as const) {
      lines.push(`  ${stage.padEnd(6)} before: [${board.before[stage].join(", ")}]`);
      lines.push(`  ${"".padEnd(6)} after:  [${board.after[stage].join(", ")}]`);
    }
  }
  if (probes.length > 0) {
    lines.push("probe GET /api/specialists?id=<id>:");
    for (const result of probes) lines.push(`  ${result.id}  ${result.status}`);
  }
  lines.push(...extra);
  return lines.join("\n");
}

export async function runConfigure(
  options: Options,
  context: { now?: Date; env?: Record<string, string | undefined> } = {},
): Promise<RunResult> {
  const now = context.now ?? new Date();
  const dbPath = path.resolve(options.dbPath);
  if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);
  if (options.boards.length === 0) throw new Error("--boards <id,id,...> is required");

  if (options.mode === "rollback") return rollback(options, dbPath);

  // Resolve and plan on a read-only connection first; nothing is written before the probe passes.
  const readDb = new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true });
  let planned: Planned[];
  try {
    const rows = resolveBoards(readDb, options.boards, options.allowRoutaBoard);
    planned = plan(readDb, rows, resolverPath(context.env));
  } finally {
    readDb.close();
  }

  const probes = await probe(options.baseUrl, requiredSpecialistIds(planned));
  const reports = (changedIds: Set<string>) =>
    planned.map(({ row, columns, next, flight }): BoardReport => ({
      id: row.id,
      name: row.name,
      before: stageSteps(columns),
      after: stageSteps(next),
      changed: changedIds.has(row.id),
      flight,
    }));

  if (options.mode === "check") {
    const boards = reports(new Set());
    const allLoaded = probes.every((result) => result.status === 200);
    return {
      mode: "check",
      exitCode: 0,
      boards,
      probes,
      output: formatOutput("check", boards, probes, allLoaded ? [] : [`note: ${PROBE_FAILURE_MESSAGE}`]),
    };
  }

  if (!probes.every((result) => result.status === 200)) {
    const boards = reports(new Set());
    return {
      mode: "apply",
      exitCode: 3,
      boards,
      probes,
      message: PROBE_FAILURE_MESSAGE,
      output: formatOutput("apply", boards, probes, [PROBE_FAILURE_MESSAGE, "nothing written"]),
    };
  }

  const toUpdate = planned.filter((entry) => entry.changed);
  let backupPath: string | undefined;
  if (toUpdate.length > 0) {
    const db = new BetterSqlite3(dbPath, { fileMustExist: true });
    try {
      // Re-read on the write connection so a board changed after planning is not overwritten blindly.
      const current = new Map(
        resolveBoards(db, toUpdate.map(({ row }) => row.id), true).map((row) => [row.id, row]),
      );
      for (const { row } of toUpdate) {
        if (current.get(row.id)?.columns !== row.columns || current.get(row.id)?.updated_at !== row.updated_at) {
          throw new Error(`Board ${row.id} changed while planning; re-run --apply`);
        }
      }

      const backupDir = path.resolve(options.backupDir ?? path.dirname(dbPath));
      fs.mkdirSync(backupDir, { recursive: true });
      const stamp = now.toISOString().replace(/[:.]/g, "-");
      backupPath = path.join(backupDir, `kanban-flight-checklist-backup-${stamp}.json`);
      const backup: BackupFile = {
        createdAt: now.toISOString(),
        boards: toUpdate.map(({ row, next }) => ({
          id: row.id,
          name: row.name,
          columns: row.columns,
          updated_at: row.updated_at,
          newColumns: JSON.stringify(next),
        })),
      };
      fs.writeFileSync(backupPath, `${JSON.stringify(backup, null, 2)}\n`, { flag: "wx" });

      const update = db.prepare("UPDATE kanban_boards SET columns = ?, updated_at = ? WHERE id = ?");
      db.transaction(() => {
        for (const entry of backup.boards) update.run(entry.newColumns, now.getTime(), entry.id);
      })();
    } finally {
      db.close();
    }
  }

  const boards = reports(new Set(toUpdate.map(({ row }) => row.id)));
  return {
    mode: "apply",
    exitCode: 0,
    boards,
    probes,
    backupPath,
    output: formatOutput("apply", boards, probes, [backupPath ? `backup: ${backupPath}` : "no changes; no backup written"]),
  };
}

function describeDifferences(current: Column[], expected: Column[]): string[] {
  const stages = new Set([...current, ...expected].map((column) => column.stage ?? column.id ?? "?"));
  const differences: string[] = [];
  for (const stage of stages) {
    const left = current.find((column) => (column.stage ?? column.id) === stage);
    const right = expected.find((column) => (column.stage ?? column.id) === stage);
    if (!isDeepStrictEqual(left, right)) differences.push(stage);
  }
  return differences.length > 0 ? differences : ["column order"];
}

function rollback(options: Options, dbPath: string): RunResult {
  if (!options.rollbackFile) throw new Error("--rollback <backup file> is required");
  const backup = JSON.parse(fs.readFileSync(path.resolve(options.rollbackFile), "utf8")) as BackupFile;
  if (!Array.isArray(backup.boards)) throw new Error(`Not a flight checklist backup: ${options.rollbackFile}`);

  const db = new BetterSqlite3(dbPath, { fileMustExist: true });
  try {
    const rows = resolveBoards(db, options.boards, options.allowRoutaBoard);
    const entries = rows.map((row) => {
      const entry = backup.boards.find((candidate) => candidate.id === row.id);
      if (!entry) throw new Error(`Backup has no entry for board ${row.id}`);
      return { row, entry };
    });

    const mismatches: string[] = [];
    for (const { row, entry } of entries) {
      const current = parseColumns(row);
      const expected = JSON.parse(entry.newColumns) as Column[];
      if (!isDeepStrictEqual(current, expected)) {
        mismatches.push(`${row.id} (${row.name}): ${describeDifferences(current, expected).join(", ")}`);
      }
    }
    if (mismatches.length > 0 && !options.force) {
      throw new Error(
        [
          "Refusing to roll back: current columns differ from the backup's new columns (someone changed them after --apply).",
          ...mismatches.map((line) => `  ${line}`),
          "Nothing was written. Pass --force to overwrite anyway.",
        ].join("\n"),
      );
    }

    const update = db.prepare("UPDATE kanban_boards SET columns = ?, updated_at = ? WHERE id = ?");
    db.transaction(() => {
      for (const { entry } of entries) update.run(entry.columns, entry.updated_at, entry.id);
    })();

    const boards = entries.map(({ row, entry }): BoardReport => ({
      id: row.id,
      name: row.name,
      before: stageSteps(parseColumns(row)),
      after: stageSteps(JSON.parse(entry.columns) as Column[]),
      changed: true,
    }));
    const extra = [`restored from ${path.resolve(options.rollbackFile)}`];
    if (mismatches.length > 0) extra.push("forced over differences:", ...mismatches.map((line) => `  ${line}`));
    return { mode: "rollback", exitCode: 0, boards, probes: [], output: formatOutput("rollback", boards, [], extra) };
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await runConfigure(parseArgs(process.argv.slice(2)));
    console.log(result.output);
    if (result.exitCode === 3) console.error(PROBE_FAILURE_MESSAGE);
    process.exitCode = result.exitCode;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
