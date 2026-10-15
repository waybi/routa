/**
 * Configure the Done lane of three boards to run
 * [kanban-main-pusher, kanban-done-reporter].
 *
 * Usage:
 *   node --import tsx scripts/kanban/configure-done-main-pusher.ts --db <path> --check
 *   node --import tsx scripts/kanban/configure-done-main-pusher.ts --db <path> --apply [--backup-dir <dir>]
 *
 * --check is read-only. --apply backs up the original columns to a JSON file,
 * then updates only the Done column steps of the target boards in one
 * transaction. Re-running --apply when the boards are already configured
 * writes nothing and creates no backup.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import BetterSqlite3 from "better-sqlite3";

export const TARGET_BOARD_IDS = [
  "f635c1de-44a8-4d5c-af42-34244e69eb55", // local-tools Board
  "2c17ef3e-411b-4f22-b002-e2b4c9309c91", // deepseek-harness Board
  "361d06fd-6478-4995-9b6e-ab0b0b271471", // Routa Board
] as const;

export const MAIN_PUSHER_STEP = {
  id: "main-pusher",
  role: "DEVELOPER",
  specialistId: "kanban-main-pusher",
  specialistName: "Main Pusher",
} as const;

const DONE_REPORTER_ID = "kanban-done-reporter";
const DESIRED_SPECIALIST_IDS = [MAIN_PUSHER_STEP.specialistId, DONE_REPORTER_ID];

export type Mode = "check" | "apply";

export interface Options {
  dbPath: string;
  mode: Mode;
  backupDir?: string;
}

interface Step {
  id?: string;
  role?: string;
  specialistId?: string;
  specialistName?: string;
  specialistLocale?: string;
  providerId?: string;
  [key: string]: unknown;
}

interface Column {
  id?: string;
  stage?: string;
  automation?: {
    steps?: Step[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface BoardRow {
  id: string;
  name: string;
  columns: string;
  updated_at: number;
}

export interface BoardReport {
  id: string;
  name: string;
  doneSteps: string[];
  changed: boolean;
}

export interface RunResult {
  mode: Mode;
  boards: BoardReport[];
  backupPath?: string;
}

export function parseArgs(argv: string[]): Options {
  let dbPath: string | undefined;
  let backupDir: string | undefined;
  const modes: Mode[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--db") {
      dbPath = argv[++index];
    } else if (arg === "--backup-dir") {
      backupDir = argv[++index];
    } else if (arg === "--check") {
      modes.push("check");
    } else if (arg === "--apply") {
      modes.push("apply");
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!dbPath) throw new Error("--db <path> is required");
  if (modes.length !== 1) throw new Error("Pass exactly one of --check or --apply");
  return { dbPath, mode: modes[0]!, backupDir };
}

function findDoneColumn(columns: Column[]): Column | undefined {
  return columns.find((column) => column.stage === "done");
}

function stepIds(column: Column | undefined): string[] {
  return (column?.automation?.steps ?? []).map(
    (step) => step.specialistId ?? step.specialistName ?? step.role ?? "unknown",
  );
}

function isConfigured(column: Column | undefined): boolean {
  const ids = stepIds(column);
  return ids.length === DESIRED_SPECIALIST_IDS.length
    && ids.every((id, index) => id === DESIRED_SPECIALIST_IDS[index]);
}

/** Return new columns with only the Done column's steps (and mirrored primary-step fields) replaced. */
export function withMainPusher(columns: Column[]): Column[] {
  return columns.map((column) => {
    if (column.stage !== "done") return column;
    const automation = column.automation ?? {};
    const existingSteps = automation.steps ?? [];
    const reporter = existingSteps.find((step) => step.specialistId === DONE_REPORTER_ID);
    if (!reporter) {
      throw new Error(`Done column ${column.id ?? "?"} has no ${DONE_REPORTER_ID} step`);
    }
    // The board's primary-step fields mirror steps[0] (normalizeKanbanAutomation).
    const nextAutomation: NonNullable<Column["automation"]> = {
      ...automation,
      steps: [{ ...MAIN_PUSHER_STEP }, reporter],
      role: MAIN_PUSHER_STEP.role,
      specialistId: MAIN_PUSHER_STEP.specialistId,
      specialistName: MAIN_PUSHER_STEP.specialistName,
    };
    delete nextAutomation.providerId;
    delete nextAutomation.specialistLocale;
    return { ...column, automation: nextAutomation };
  });
}

function loadTargetRows(db: BetterSqlite3.Database): BoardRow[] {
  const statement = db.prepare(
    "SELECT id, name, columns, updated_at FROM kanban_boards WHERE id = ?",
  );
  return TARGET_BOARD_IDS.map((id) => {
    const row = statement.get(id) as BoardRow | undefined;
    if (!row) throw new Error(`Board ${id} not found`);
    return row;
  });
}

export function runConfigure(options: Options, now: Date = new Date()): RunResult {
  const dbPath = path.resolve(options.dbPath);
  if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

  if (options.mode === "check") {
    const db = new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true });
    try {
      const boards = loadTargetRows(db).map((row) => {
        const done = findDoneColumn(JSON.parse(row.columns) as Column[]);
        return { id: row.id, name: row.name, doneSteps: stepIds(done), changed: false };
      });
      return { mode: "check", boards };
    } finally {
      db.close();
    }
  }

  const db = new BetterSqlite3(dbPath, { fileMustExist: true });
  try {
    const rows = loadTargetRows(db);
    const pending = rows
      .map((row) => {
        const columns = JSON.parse(row.columns) as Column[];
        const done = findDoneColumn(columns);
        if (!done) throw new Error(`Board ${row.id} has no Done column`);
        return { row, columns, configured: isConfigured(done) };
      });
    const toUpdate = pending.filter((entry) => !entry.configured);

    let backupPath: string | undefined;
    if (toUpdate.length > 0) {
      const backupDir = path.resolve(options.backupDir ?? path.dirname(dbPath));
      fs.mkdirSync(backupDir, { recursive: true });
      const stamp = now.toISOString().replace(/[:.]/g, "-");
      backupPath = path.join(backupDir, `kanban-done-backup-${stamp}.json`);
      const backup = toUpdate.map(({ row }) => ({
        id: row.id,
        name: row.name,
        columns: row.columns,
        updated_at: row.updated_at,
      }));
      fs.writeFileSync(backupPath, `${JSON.stringify(backup, null, 2)}\n`, { flag: "wx" });

      const update = db.prepare("UPDATE kanban_boards SET columns = ?, updated_at = ? WHERE id = ?");
      const timestamp = now.getTime();
      db.transaction(() => {
        for (const { row, columns } of toUpdate) {
          update.run(JSON.stringify(withMainPusher(columns)), timestamp, row.id);
        }
      })();
    }

    const updatedIds = new Set(toUpdate.map(({ row }) => row.id));
    const boards = loadTargetRows(db).map((row) => ({
      id: row.id,
      name: row.name,
      doneSteps: stepIds(findDoneColumn(JSON.parse(row.columns) as Column[])),
      changed: updatedIds.has(row.id),
    }));
    return { mode: "apply", boards, backupPath };
  } finally {
    db.close();
  }
}

export function formatResult(result: RunResult): string {
  const lines = result.boards.map((board) => {
    const suffix = result.mode === "apply" ? (board.changed ? " (updated)" : " (unchanged)") : "";
    return `${board.id}  ${board.name}  done: [${board.doneSteps.join(", ")}]${suffix}`;
  });
  if (result.mode === "apply") {
    lines.push(result.backupPath ? `backup: ${result.backupPath}` : "no changes; no backup written");
  }
  return lines.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    console.log(formatResult(runConfigure(options)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
