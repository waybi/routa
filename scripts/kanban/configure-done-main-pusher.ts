/**
 * Configure the Done lane of every eligible board to run
 * [kanban-main-pusher, kanban-done-reporter].
 *
 * Every board in kanban_boards is checked. A board is eligible ("configure")
 * only when its workspace has exactly one codebase, that codebase is a git
 * repository with an origin remote, it is not TopBI/Gerrit (same rule as the
 * main pusher's runtime skip in main-pusher.yaml Workflow step 2), and its Done
 * column has a kanban-done-reporter step. Otherwise the board is skipped with
 * a reason. No hard-coded board list.
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
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import BetterSqlite3 from "better-sqlite3";

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
  workspace_id: string;
  name: string;
  columns: string;
  updated_at: number;
}

export type Decision = "configure" | "skip";

export interface BoardReport {
  id: string;
  name: string;
  decision: Decision;
  reason: string;
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

function loadBoards(db: BetterSqlite3.Database): BoardRow[] {
  return db
    .prepare("SELECT id, workspace_id, name, columns, updated_at FROM kanban_boards ORDER BY created_at, id")
    .all() as BoardRow[];
}

function git(repoPath: string, args: string[]): string {
  return execFileSync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    // Do not let git walk up and pick a parent repository.
    env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(fs.realpathSync(repoPath)) },
  }).trim();
}

interface Verdict {
  decision: Decision;
  reason: string;
  columns?: Column[];
}

/**
 * Decide whether a board's Done lane should get the main pusher. Checks run in
 * order and stop at the first skip. Never throws: unexpected errors become a skip.
 */
function decide(db: BetterSqlite3.Database, row: BoardRow): Verdict {
  try {
    const codebases = db
      .prepare("SELECT repo_path FROM codebases WHERE workspace_id = ? ORDER BY created_at, id")
      .all(row.workspace_id) as Array<{ repo_path: string }>;
    if (codebases.length === 0) return { decision: "skip", reason: "未绑定代码仓" };
    if (codebases.length > 1) {
      return { decision: "skip", reason: `多代码仓，不自动推送（${codebases.length} 个）` };
    }
    const repoPath = codebases[0]!.repo_path;

    let isRepo = false;
    if (repoPath && fs.existsSync(repoPath) && fs.statSync(repoPath).isDirectory()) {
      try {
        git(repoPath, ["rev-parse", "--git-dir"]);
        isRepo = true;
      } catch {
        isRepo = false;
      }
    }
    if (!isRepo) return { decision: "skip", reason: `代码仓目录不存在或不是 git 仓库：${repoPath}` };

    let origin: string;
    try {
      origin = git(repoPath, ["remote", "get-url", "origin"]);
    } catch {
      return { decision: "skip", reason: `没有 origin 远端：${repoPath}` };
    }

    // Same rule as main-pusher.yaml Workflow step 2 (runtime skip).
    if (/topbi/i.test(repoPath) || /gerrit/i.test(origin) || origin.includes(":29418")) {
      return { decision: "skip", reason: `Gerrit 走评审，不直推：${repoPath}` };
    }

    let columns: Column[];
    try {
      columns = JSON.parse(row.columns) as Column[];
    } catch {
      return { decision: "skip", reason: "看板列配置不是合法 JSON" };
    }
    if (!Array.isArray(columns)) return { decision: "skip", reason: "看板列配置不是数组" };
    const done = findDoneColumn(columns);
    if (!done) return { decision: "skip", reason: "没有 Done 列" };
    if (!(done.automation?.steps ?? []).some((step) => step.specialistId === DONE_REPORTER_ID)) {
      return { decision: "skip", reason: `Done 列没有 ${DONE_REPORTER_ID} 步骤` };
    }

    return { decision: "configure", reason: `要配：代码仓 ${repoPath}`, columns };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { decision: "skip", reason: `判定出错：${message}` };
  }
}

function currentDoneSteps(columnsJson: string): string[] {
  try {
    const columns = JSON.parse(columnsJson) as Column[];
    return Array.isArray(columns) ? stepIds(findDoneColumn(columns)) : [];
  } catch {
    return [];
  }
}

export function runConfigure(options: Options, now: Date = new Date()): RunResult {
  const dbPath = path.resolve(options.dbPath);
  if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

  if (options.mode === "check") {
    const db = new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true });
    try {
      const boards = loadBoards(db).map((row): BoardReport => {
        const verdict = decide(db, row);
        return {
          id: row.id,
          name: row.name,
          decision: verdict.decision,
          reason: verdict.reason,
          doneSteps: currentDoneSteps(row.columns),
          changed: false,
        };
      });
      return { mode: "check", boards };
    } finally {
      db.close();
    }
  }

  const db = new BetterSqlite3(dbPath, { fileMustExist: true });
  try {
    const verdicts = new Map<string, Verdict>();
    const toUpdate: Array<{ row: BoardRow; columns: Column[] }> = [];
    for (const row of loadBoards(db)) {
      const verdict = decide(db, row);
      verdicts.set(row.id, verdict);
      if (verdict.decision === "configure" && verdict.columns && !isConfigured(findDoneColumn(verdict.columns))) {
        toUpdate.push({ row, columns: verdict.columns });
      }
    }

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
    // Re-read rows for the new Done steps, but keep the verdicts computed before writing.
    const boards = loadBoards(db).map((row): BoardReport => {
      const verdict = verdicts.get(row.id) ?? { decision: "skip" as const, reason: "写入期间新增的看板，未判定" };
      return {
        id: row.id,
        name: row.name,
        decision: verdict.decision,
        reason: verdict.reason,
        doneSteps: currentDoneSteps(row.columns),
        changed: updatedIds.has(row.id),
      };
    });
    return { mode: "apply", boards, backupPath };
  } finally {
    db.close();
  }
}

export function formatResult(result: RunResult): string {
  const lines = result.boards.map((board) => {
    const suffix = result.mode === "apply" ? (board.changed ? " (updated)" : " (unchanged)") : "";
    return `${board.id}  ${board.name}  ${board.decision}  ${board.reason}  done: [${board.doneSteps.join(", ")}]${suffix}`;
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
