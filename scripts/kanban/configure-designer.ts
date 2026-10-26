/**
 * Mount the kanban-designer step in the Todo column of every board whose Todo column runs
 * kanban-todo-orchestrator:
 *
 *   todo : [kanban-todo-orchestrator, kanban-designer, kanban-contract-setter, ...]
 *
 * The designer goes right before the first kanban-contract-setter that follows the
 * orchestrator, or right after the orchestrator when there is none. Boards that already
 * have kanban-designer, or whose Todo column has no orchestrator, are left as they are.
 *
 * Usage:
 *   node --import tsx scripts/kanban/configure-designer.ts --db <path> --dry-run [--base-url <url>]
 *   node --import tsx scripts/kanban/configure-designer.ts --db <path> [--backup-dir <dir>] [--base-url <url>]
 *
 * It first probes GET <base>/api/specialists?id=kanban-designer. Routa caches specialist
 * files per process, so anything but 200 means Routa must be restarted first: exit code 3,
 * the database is not opened for writing. --dry-run only prints the boards and columns
 * that would change. Before writing, the old columns are saved to a backup JSON file.
 * Exit codes: 0 ok / dry run, 1 argument or data error, 3 probe failed.
 */
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";
import BetterSqlite3 from "better-sqlite3";

export const DESIGNER_ID = "kanban-designer";
export const TODO_ORCHESTRATOR_ID = "kanban-todo-orchestrator";
export const CONTRACT_SETTER_ID = "kanban-contract-setter";
export const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
export const PROBE_FAILURE_MESSAGE =
  "Routa 进程还没加载 kanban-designer 岗位文件（岗位文件按进程缓存，要重启 Routa 才读到）；未写库";

/** Runtime fields copied from the todo-orchestrator step onto the designer step. */
const CARRIED_FIELDS = ["providerId", "model", "reasoningEffort", "specialistLocale", "transport"] as const;

export interface Step {
  id?: string;
  role?: string;
  specialistId?: string;
  specialistName?: string;
  [key: string]: unknown;
}

export interface Column {
  id?: string;
  name?: string;
  stage?: string;
  automation?: { steps?: Step[]; [key: string]: unknown };
  [key: string]: unknown;
}

export interface Options {
  dbPath: string;
  dryRun: boolean;
  baseUrl: string;
  backupDir?: string;
}

interface BoardRow {
  id: string;
  name: string;
  columns: string;
  updated_at: number;
}

export interface BoardChange {
  id: string;
  name: string;
  column: string;
  before: string[];
  after: string[];
}

export interface RunResult {
  exitCode: 0 | 3;
  probeStatus: number | "unreachable";
  changes: BoardChange[];
  backupPath?: string;
  output: string;
}

export interface RunContext {
  now?: Date;
  fetchImpl?: typeof fetch;
}

export function parseArgs(argv: string[]): Options {
  let dbPath: string | undefined;
  let backupDir: string | undefined;
  let baseUrl = DEFAULT_BASE_URL;
  let dryRun = false;
  const value = (index: number, flag: string): string => {
    const next = argv[index];
    if (next === undefined || next.startsWith("--")) throw new Error(`${flag} needs a value`);
    return next;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--db") dbPath = value(++index, arg);
    else if (arg === "--backup-dir") backupDir = value(++index, arg);
    else if (arg === "--base-url") baseUrl = value(++index, arg);
    else if (arg === "--dry-run") dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!dbPath) throw new Error("--db <path> is required");
  return { dbPath, dryRun, baseUrl, backupDir };
}

function isChineseLocale(step: Step): boolean {
  return typeof step.specialistLocale === "string" && step.specialistLocale.toLowerCase().startsWith("zh");
}

/** The designer step, with runtime fields (provider, model, locale, ...) taken from the orchestrator step. */
export function buildDesignerStep(orchestrator: Step): Step {
  const step: Step = {
    id: "designer",
    role: "CRAFTER",
    specialistId: DESIGNER_ID,
    specialistName: isChineseLocale(orchestrator) ? "设计师" : "Designer",
  };
  for (const field of CARRIED_FIELDS) {
    if (orchestrator[field] !== undefined) step[field] = orchestrator[field];
  }
  return step;
}

function withDesignerInTodo(column: Column): Column {
  const steps = column.automation?.steps;
  if (!Array.isArray(steps)) return column;
  const orchestratorIndex = steps.findIndex((step) => step?.specialistId === TODO_ORCHESTRATOR_ID);
  if (orchestratorIndex < 0) return column;
  if (steps.some((step) => step?.specialistId === DESIGNER_ID)) return column;
  const setterOffset = steps.slice(orchestratorIndex + 1).findIndex((step) => step?.specialistId === CONTRACT_SETTER_ID);
  const insertAt = setterOffset >= 0 ? orchestratorIndex + 1 + setterOffset : orchestratorIndex + 1;
  const next = [...steps.slice(0, insertAt), buildDesignerStep(steps[orchestratorIndex]!), ...steps.slice(insertAt)];
  return { ...column, automation: { ...column.automation, steps: next } };
}

/**
 * Return columns with the designer step mounted in the Todo column. Columns that need no
 * change (non-Todo, no orchestrator, designer already present) are returned as they are.
 */
export function withDesignerStep(columns: Column[]): Column[] {
  return columns.map((column) => (column?.stage === "todo" ? withDesignerInTodo(column) : column));
}

function stepIds(column: Column | undefined): string[] {
  return (column?.automation?.steps ?? []).map((step) => step?.specialistId ?? step?.specialistName ?? step?.role ?? "unknown");
}

function parseColumns(row: BoardRow): Column[] {
  let columns: unknown;
  try {
    columns = JSON.parse(row.columns);
  } catch (error) {
    throw new Error(`Board ${row.id} (${row.name}): columns is not valid JSON; nothing written`, { cause: error });
  }
  if (!Array.isArray(columns)) throw new Error(`Board ${row.id} (${row.name}): columns is not a JSON array; nothing written`);
  return columns as Column[];
}

async function probe(baseUrl: string, fetchImpl: typeof fetch): Promise<number | "unreachable"> {
  const url = `${baseUrl.replace(/\/+$/, "")}/api/specialists?id=${encodeURIComponent(DESIGNER_ID)}`;
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
    await response.body?.cancel();
    return response.status;
  } catch {
    return "unreachable";
  }
}

interface Planned {
  row: BoardRow;
  next: Column[];
  change: BoardChange;
}

function plan(rows: BoardRow[]): Planned[] {
  // Parse and plan every board first; one bad board aborts the run before anything is written.
  const planned: Planned[] = [];
  for (const row of rows) {
    const columns = parseColumns(row);
    const next = withDesignerStep(columns);
    if (isDeepStrictEqual(columns, next)) continue;
    const index = next.findIndex((column, i) => !isDeepStrictEqual(column, columns[i]));
    planned.push({
      row,
      next,
      change: {
        id: row.id,
        name: row.name,
        column: String(next[index]?.name ?? next[index]?.id ?? "todo"),
        before: stepIds(columns[index]),
        after: stepIds(next[index]),
      },
    });
  }
  return planned;
}

function formatChanges(changes: BoardChange[]): string[] {
  if (changes.length === 0) return ["no board needs the designer step"];
  return changes.map(
    (change) => `${change.id}  ${change.name} | column ${change.column} | [${change.before.join(", ")}] -> [${change.after.join(", ")}]`,
  );
}

export async function runConfigureDesigner(options: Options, context: RunContext = {}): Promise<RunResult> {
  const now = context.now ?? new Date();
  const dbPath = path.resolve(options.dbPath);
  if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

  // Probe before the database is opened at all: a 404/500/unreachable Routa never gets a write.
  const probeStatus = await probe(options.baseUrl, context.fetchImpl ?? fetch);
  if (probeStatus !== 200) {
    return {
      exitCode: 3,
      probeStatus,
      changes: [],
      output: [`probe GET /api/specialists?id=${DESIGNER_ID}: ${probeStatus}`, PROBE_FAILURE_MESSAGE].join("\n"),
    };
  }

  const readDb = new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true });
  let planned: Planned[];
  try {
    const rows = readDb.prepare("SELECT id, name, columns, updated_at FROM kanban_boards ORDER BY id").all() as BoardRow[];
    planned = plan(rows);
  } finally {
    readDb.close();
  }
  const changes = planned.map((entry) => entry.change);
  const head = `probe GET /api/specialists?id=${DESIGNER_ID}: 200`;

  if (options.dryRun) {
    return { exitCode: 0, probeStatus, changes, output: [head, "dry run, nothing written:", ...formatChanges(changes)].join("\n") };
  }
  if (planned.length === 0) {
    return { exitCode: 0, probeStatus, changes, output: [head, ...formatChanges(changes), "no backup written"].join("\n") };
  }

  const db = new BetterSqlite3(dbPath, { fileMustExist: true });
  let backupPath: string;
  try {
    // Re-read on the write connection so a board changed after planning is not overwritten blindly.
    const current = db.prepare("SELECT columns, updated_at FROM kanban_boards WHERE id = ?");
    for (const { row } of planned) {
      const fresh = current.get(row.id) as { columns: string; updated_at: number } | undefined;
      if (fresh?.columns !== row.columns || fresh?.updated_at !== row.updated_at) {
        throw new Error(`Board ${row.id} changed while planning; re-run`);
      }
    }
    const backupDir = path.resolve(options.backupDir ?? path.dirname(dbPath));
    fs.mkdirSync(backupDir, { recursive: true });
    backupPath = path.join(backupDir, `kanban-designer-backup-${now.toISOString().replace(/[:.]/g, "-")}.json`);
    const backup = {
      createdAt: now.toISOString(),
      boards: planned.map(({ row, next }) => ({
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
  return {
    exitCode: 0,
    probeStatus,
    changes,
    backupPath,
    output: [head, "updated:", ...formatChanges(changes), `backup: ${backupPath}`].join("\n"),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await runConfigureDesigner(parseArgs(process.argv.slice(2)));
    console.log(result.output);
    process.exitCode = result.exitCode;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
