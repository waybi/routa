/**
 * Shared fixtures for git tests: throwaway repos under os.tmpdir() and a fake
 * `git` on PATH that counts `git pull` calls (optionally slow or failing) and
 * forwards every other command to the real git.
 */
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const REAL_GIT = execFileSync("which", ["git"], { encoding: "utf8" }).trim();

export function runGit(cwd: string, ...args: string[]): string {
  return execFileSync(REAL_GIT, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

export function makeTempDir(prefix = "routa-git-test-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function makeRepo(branch = "main"): string {
  const dir = makeTempDir();
  runGit(dir, "init", "-q", "-b", branch);
  runGit(dir, "config", "user.email", "t@example.com");
  runGit(dir, "config", "user.name", "Test");
  runGit(dir, "config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(dir, "README.md"), "hello\n");
  runGit(dir, "add", "-A");
  runGit(dir, "commit", "-q", "-m", "init");
  return dir;
}

export function commitFile(dir: string, name: string, content = "x\n"): void {
  fs.writeFileSync(path.join(dir, name), content);
  runGit(dir, "add", "-A");
  runGit(dir, "commit", "-q", "-m", `add ${name}`);
}

export interface FakeGit {
  pullCount(): number;
  restore(): void;
}

/** Put a fake git first on PATH. Env knobs: FAKE_GIT_SLEEP (seconds), FAKE_GIT_PULL_EXIT. */
export function installFakeGit(): FakeGit {
  const dir = makeTempDir("routa-fake-git-");
  const log = path.join(dir, "pulls.log");
  fs.writeFileSync(log, "");
  const script = [
    "#!/bin/sh",
    'if [ "$1" = "pull" ]; then',
    `  echo "pull" >> "${log}"`,
    '  if [ -n "$FAKE_GIT_SLEEP" ]; then sleep "$FAKE_GIT_SLEEP"; fi',
    '  if [ -n "$FAKE_GIT_PULL_EXIT" ] && [ "$FAKE_GIT_PULL_EXIT" != "0" ]; then echo "fatal: unable to access remote" >&2; exit "$FAKE_GIT_PULL_EXIT"; fi',
    "  exit 0",
    "fi",
    `exec "${REAL_GIT}" "$@"`,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(dir, "git"), script, { mode: 0o755 });
  const originalPath = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${originalPath}`;
  return {
    pullCount: () => fs.readFileSync(log, "utf8").split("\n").filter(Boolean).length,
    restore: () => {
      process.env.PATH = originalPath;
      delete process.env.FAKE_GIT_SLEEP;
      delete process.env.FAKE_GIT_PULL_EXIT;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
