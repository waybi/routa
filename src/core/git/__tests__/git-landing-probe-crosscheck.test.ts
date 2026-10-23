import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { computeLandingFromRefs } from "../git-landing-probe";

/**
 * Random cross-check of the replay layers against an answer computed from
 * the requirement: every task commit is built into one of five kinds, and
 * only "decoy" (same subject, other path set) and "absent" may count.
 *
 * Default 20 repos x 50 commits; full run:
 *   LANDING_CROSSCHECK_REPOS=200 LANDING_CROSSCHECK_SEED=7 npx vitest run <this file>
 */

const REPOS = Number(process.env.LANDING_CROSSCHECK_REPOS ?? 20);
const COMMITS = Number(process.env.LANDING_CROSSCHECK_COMMITS ?? 50);
const SEED = Number(process.env.LANDING_CROSSCHECK_SEED ?? 1);

type Kind = "cherryPick" | "content" | "subjectFiles" | "decoy" | "absent";
const ALL_KINDS: Kind[] = ["cherryPick", "content", "subjectFiles", "decoy", "absent"];
const LANDABLE_KINDS: Kind[] = ["cherryPick", "content", "subjectFiles"];

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

interface FakeCommit {
  message: string;
  files: Record<string, string>;
}

function fastImport(branch: string, from: string | null, commits: FakeCommit[], clock: { t: number }): string {
  let stream = "";
  commits.forEach((commit, i) => {
    clock.t += 1;
    stream += `commit refs/heads/${branch}\ncommitter T <t@example.com> ${clock.t} +0000\n`;
    stream += `data ${Buffer.byteLength(commit.message)}\n${commit.message}\n`;
    if (i === 0 && from) stream += `from ${from}\n`;
    for (const [file, content] of Object.entries(commit.files)) {
      stream += `M 100644 inline ${file}\ndata ${Buffer.byteLength(content)}\n${content}\n`;
    }
  });
  return stream;
}

const tempDirs: string[] = [];

function buildRepo(random: () => number, index: number): { repo: string; expected: number; kinds: Kind[] } {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "routa-landing-xcheck-"));
  tempDirs.push(repo);
  execFileSync("git", ["init", "-q", "--bare", repo]);
  const allowed = random() < 0.3 ? LANDABLE_KINDS : ALL_KINDS;
  const kinds = Array.from({ length: COMMITS }, () => allowed[Math.floor(random() * allowed.length)]);
  const clock = { t: 1700000000 };

  const rootFiles: Record<string, string> = {};
  kinds.forEach((_, i) => { rootFiles[`t${i}.txt`] = `orig ${i}\n`; });
  const task: FakeCommit[] = kinds.map((_, i) => ({
    message: `task commit ${index}-${i} ${Math.floor(random() * 1e9)}`,
    files: { [`t${i}.txt`]: `task ${i}\n` },
  }));

  // Base commit groups keep their internal order but are interleaved randomly.
  const groups: FakeCommit[][] = kinds.map((kind, i) => {
    const file = `t${i}.txt`;
    switch (kind) {
      case "cherryPick": return [{ message: `picked ${i}`, files: { [file]: `task ${i}\n` } }];
      case "content": return [
        { message: `content a ${i}`, files: { [file]: `tmp ${i}\n` } },
        { message: `content b ${i}`, files: { [file]: `task ${i}\n` } },
      ];
      case "subjectFiles": return [
        { message: task[i].message, files: { [file]: `fixed ${i}\n` } },
        { message: `later ${i}`, files: { [file]: `later ${i}\n` } },
      ];
      case "decoy": return [{ message: task[i].message, files: { [file]: `decoy ${i}\n`, [`x${i}.txt`]: "extra\n" } }];
      case "absent": return [];
    }
  });
  groups.push([{ message: "unrelated", files: { "u.txt": "u\n" } }]);
  const base: FakeCommit[] = [];
  const queues = groups.filter((group) => group.length > 0).map((group) => group.slice());
  while (queues.length > 0) {
    const q = Math.floor(random() * queues.length);
    base.push(queues[q].shift()!);
    if (queues[q].length === 0) queues.splice(q, 1);
  }

  execFileSync("git", ["fast-import", "--quiet"], {
    cwd: repo,
    input: fastImport("main", null, [{ message: "root", files: rootFiles }], clock),
  });
  const root = execFileSync("git", ["rev-parse", "main"], { cwd: repo, encoding: "utf8" }).trim();
  execFileSync("git", ["fast-import", "--quiet"], {
    cwd: repo,
    input: fastImport("task", root, task, clock) + fastImport("base", root, base, clock),
  });
  const expected = kinds.filter((kind) => kind === "decoy" || kind === "absent").length;
  return { repo, expected, kinds };
}

describe("landing probe random cross-check (F3-a)", () => {
  afterAll(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it(`${REPOS} repos x ${COMMITS} commits, seed ${SEED}: 0 mismatches`, async () => {
    const random = mulberry32(SEED);
    const mismatches: string[] = [];
    let commits = 0;
    let landedRepos = 0;
    for (let i = 0; i < REPOS; i += 1) {
      const { repo, expected, kinds } = buildRepo(random, i);
      const sha = (ref: string) => execFileSync("git", ["rev-parse", ref], { cwd: repo, encoding: "utf8" }).trim();
      const result = await computeLandingFromRefs(repo, { headSha: sha("task"), baseRef: "base", baseSha: sha("base"), baseBranch: "base" });
      commits += kinds.length;
      if (expected === 0) landedRepos += 1;
      const ok = result.reliable
        && result.status.commitsSinceBase === expected
        && result.status.landedOnBase === (expected === 0);
      if (!ok) {
        mismatches.push(`repo ${i}: expected ${expected}, got ${JSON.stringify(result.status)} reliable=${result.reliable} matchedBy=${JSON.stringify(result.matchedBy)}`);
      }
      fs.rmSync(repo, { recursive: true, force: true });
    }
    console.log(`cross-check: repos=${REPOS} commits=${commits} landedRepos=${landedRepos} mismatches=${mismatches.length}`);
    expect(mismatches).toEqual([]);
  }, 600_000);
});
