/**
 * @vitest-environment node
 *
 * F3 batch cross-check for the get_task projection (card ed9adb91): 10,000 seeded random cards are
 * judged against rules written straight from the requirement, not against the implementation.
 */
import fs from "fs";
import { describe, expect, it } from "vitest";

import { VerificationVerdict, type Task, type TaskCommentEntry, type TaskLaneSession } from "../../models/task";
import { buildTaskSnapshot, type TaskSnapshot } from "../kanban-task-snapshot";

const SEED = 20261024;
const CARDS = 10_000;
const LIMIT_BYTES = 32768;
/** Set GET_TASK_FUZZ_REPORT=<file> to append the run summary (evidence for the card). */
const report = (line: string) => {
  if (process.env.GET_TASK_FUZZ_REPORT) fs.appendFileSync(process.env.GET_TASK_FUZZ_REPORT, `${line}\n`);
};
const LANE_KEYS = new Set(["sessionId", "stepName", "role", "status", "startedAt", "completedAt", "columnId"]);

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeGenerator(seed: number) {
  const rand = mulberry32(seed);
  const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
  const alphabet = ["a", "b", "Z", " ", "\n", "7", "汉", "评", "審", "😀", "🚀", "\"", "\\"];
  let pool = "";
  while (pool.length < 70_000) pool += alphabet[int(0, alphabet.length - 1)];
  const text = (maxLen: number) => {
    const length = int(0, maxLen);
    let start = int(0, pool.length - length - 1);
    let end = start + length;
    const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff;
    const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff;
    if (isLow(pool.charCodeAt(start))) start += 1;
    if (end > start && isHigh(pool.charCodeAt(end - 1))) end -= 1;
    return pool.slice(start, Math.max(start, end));
  };
  const maybe = <T,>(value: () => T): T | undefined => (rand() < 0.5 ? value() : undefined);

  return (index: number): Task => {
    const commentCount = int(0, 200);
    const minutes = Array.from({ length: commentCount }, (_, i) => i * 7 + int(0, 6));
    const comments: TaskCommentEntry[] = minutes
      .map((minute, i) => ({
        id: `c${i}`,
        body: text(20_000),
        createdAt: new Date(Date.UTC(2026, 0, 1) + minute * 60_000).toISOString(),
        source: maybe(() => "update_card" as const),
        agentId: maybe(() => `agent-${i}`),
      }))
      .sort(() => rand() - 0.5);
    const laneSessions: TaskLaneSession[] = Array.from({ length: int(0, 8) }, (_, i) => ({
      sessionId: `s${index}-${i}`,
      stepName: maybe(() => `step ${i}`),
      role: maybe(() => "GATE"),
      status: "completed",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: maybe(() => "2026-01-01T01:00:00.000Z"),
      columnId: maybe(() => "dev"),
      objective: text(30_000),
      cwd: "/tmp/worktree/with/a/long/path",
      model: "claude-opus",
    }));
    const verdicts = [VerificationVerdict.APPROVED, VerificationVerdict.NOT_APPROVED, VerificationVerdict.BLOCKED, undefined];
    return {
      id: `task-${index}`,
      title: text(80) || "untitled",
      objective: text(30_000),
      comments,
      acceptanceCriteria: maybe(() => [text(200), text(200)]),
      verificationCommands: maybe(() => ["npx vitest run src/core/tools"]),
      status: "IN_PROGRESS",
      columnId: maybe(() => "review"),
      position: 0,
      labels: maybe(() => ["a", "b"]) ?? [],
      triggerSessionId: maybe(() => `s${index}-0`),
      lastSyncError: maybe(() => text(300)),
      verificationVerdict: verdicts[int(0, 3)],
      verificationReport: maybe(() => text(30_000)),
      laneSessions,
      laneHandoffs: [],
      sessionIds: [],
      dependencies: [],
      codebaseIds: [],
      workspaceId: "default",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    } as Task;
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !(value instanceof Date)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Independent judge: the rules come from AC2/AC3/AC5, not from the implementation. */
function judge(card: Task, out: TaskSnapshot, limitBytes = LIMIT_BYTES): string[] {
  const failures: string[] = [];
  const size = Buffer.byteLength(JSON.stringify(out, null, 2), "utf8");
  if (size > limitBytes) failures.push(`(1) ${size} bytes > ${limitBytes}`);
  if (out.commentsTotal !== card.comments.length) failures.push("(2) commentsTotal");
  const ordered = [...card.comments].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)).map((c) => c.id);
  const returned = out.comments.map((c) => c.id);
  if (returned.join(",") !== ordered.slice(ordered.length - returned.length).join(",")) failures.push("(3) not the newest tail in ascending order");
  const originals = new Map(card.comments.map((c) => [c.id, c.body]));
  const prefixRule = (label: string, original: string, shown: string, truncated: boolean) => {
    if (truncated ? !(original.startsWith(shown) && shown.length < original.length) : shown !== original) {
      failures.push(`(4) ${label}`);
    }
  };
  for (const comment of out.comments) prefixRule(`comment ${comment.id}`, originals.get(comment.id) ?? "", comment.body, comment.truncated === true);
  prefixRule("objective", card.objective, out.objective, out.truncated.objective);
  if ((card.verificationReport ?? null) === null) {
    if (out.verificationReport !== null) failures.push("(4) report should be null");
  } else {
    prefixRule("report", card.verificationReport!, out.verificationReport ?? "", out.truncated.verificationReport);
  }
  if (out.verificationVerdict !== (card.verificationVerdict ?? null)) failures.push("(5) verdict");
  if (out.laneSessions.length !== card.laneSessions.length) failures.push("(6) lane count");
  if (out.laneSessions.some((lane) => Object.keys(lane).some((key) => !LANE_KEYS.has(key)))) failures.push("(6) lane keys");
  return failures;
}

function runBatch(project: (card: Task) => TaskSnapshot, limitBytes = LIMIT_BYTES, cards = CARDS) {
  const generate = makeGenerator(SEED);
  const failures: string[] = [];
  for (let index = 0; index < cards; index += 1) {
    const card = deepFreeze(generate(index));
    try {
      failures.push(...judge(card, project(card), limitBytes).map((failure) => `card ${index}: ${failure}`));
    } catch (error) {
      failures.push(`card ${index}: (7) threw ${String(error)}`);
    }
  }
  return failures;
}

describe("get_task projection batch cross-check (F3)", () => {
  it("planted faults are caught by the judge", () => {
    const tightLimit = runBatch((card) => buildTaskSnapshot(card), 1000, 200);
    expect(tightLimit.length).toBeGreaterThan(0);
    const dropMarkers = runBatch((card) => {
      const snapshot = buildTaskSnapshot(card);
      return { ...snapshot, comments: snapshot.comments.map(({ truncated: _truncated, ...rest }) => rest) };
    }, LIMIT_BYTES, 200);
    expect(dropMarkers.length).toBeGreaterThan(0);
    report(`[F3] planted faults: limit=1000 -> ${tightLimit.length} failures (first: ${tightLimit[0]}); dropped truncated markers -> ${dropMarkers.length} failures (first: ${dropMarkers[0]})`);
  });

  it(`${CARDS} random cards (seed ${SEED}) pass every rule`, () => {
    const failures = runBatch((card) => buildTaskSnapshot(card));
    report(`[F3] seed=${SEED} cards=${CARDS} failures=${failures.length}${failures.length ? ` first=${failures[0]}` : ""}`);
    expect(failures).toEqual([]);
  }, 300_000);
});
