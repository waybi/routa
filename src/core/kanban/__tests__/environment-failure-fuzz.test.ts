// @vitest-environment node
/**
 * Card 79804de2, contract F3①②: seeded random cross-check of the rate-limit
 * classification and the planned rerun time against references written from
 * the requirement (AC1, AC6), not from the code. Each judge is first shown to
 * catch a planted defect.
 */
import { describe, expect, it } from "vitest";

import { classifyRetryableEnvironmentFailure, computeRateLimitRetryAt } from "../environment-failure";

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(random: () => number, items: readonly T[]): T => items[Math.floor(random() * items.length)];

// ── F3①: classification ─────────────────────────────────────────────────────

type Signal = "keyword:usage_limit_reached" | "keyword:rate_limit_error" | "keyword:trial_rate_limited" | "status429";

interface Piece { text: string; signal?: Signal }

const PIECES: readonly Piece[] = [
  { text: "usage_limit_reached", signal: "keyword:usage_limit_reached" },
  { text: '{"type":"rate_limit_error"}', signal: "keyword:rate_limit_error" },
  { text: "upstream trial_rate_limited", signal: "keyword:trial_rate_limited" },
  { text: "HTTP 429", signal: "status429" },
  { text: "HTTP/1.1 429 Too Many Requests", signal: "status429" },
  { text: "HTTP/2 429", signal: "status429" },
  { text: '{"status":429}', signal: "status429" },
  { text: "status 429", signal: "status429" },
  { text: "statusCode=429", signal: "status429" },
  { text: "429 Too Many Requests", signal: "status429" },
  { text: "processed 429 rows" },
  { text: "listening on port 4290" },
  { text: "session id 429ab" },
  { text: "took 1429 ms" },
  { text: "HTTP 500 Internal Server Error" },
  { text: "HTTP/1.1 503 Service Unavailable" },
  { text: '{"status":502}' },
  { text: "status: 4290" },
  { text: 'Unknown provider: "dsh". Not registered in ProviderRegistry' },
  { text: "boom" },
  { text: "Failed to create ACP session." },
  { text: "rate limit docs at example.com" },
  { text: "usage limit" },
  { text: "trial account" },
  { text: "No ACP activity for 10 minutes." },
];

const NOISE = ["alpha", "beta 42", "x=1", "[done]", "{}", "ok", "tool call 7"];

function escapeLayers(text: string, layers: number): string {
  let out = text;
  for (let layer = 0; layer < layers; layer += 1) out = JSON.stringify(out);
  return out;
}

function generateMessage(random: () => number): { text: string; signals: Signal[] } {
  const parts: string[] = [];
  const signals: Signal[] = [];
  const count = 1 + Math.floor(random() * 4);
  for (let index = 0; index < count; index += 1) {
    if (random() < 0.4) parts.push(pick(random, NOISE));
    const piece = pick(random, PIECES);
    parts.push(piece.text);
    if (piece.signal) signals.push(piece.signal);
  }
  return { text: escapeLayers(parts.join(" | "), Math.floor(random() * 4)), signals };
}

/** AC1: any of the three keywords, or an explicit HTTP 429 status form. */
function referenceRateLimited(signals: Signal[], keywords: readonly string[]): boolean {
  return signals.some((signal) => signal === "status429" || keywords.includes(signal.replace("keyword:", "")));
}

const AC1_KEYWORDS = ["usage_limit_reached", "rate_limit_error", "trial_rate_limited"] as const;

function judgeClassification(keywords: readonly string[], seed: number, total: number): { mismatches: number; hits: number } {
  const random = mulberry32(seed);
  let mismatches = 0;
  let hits = 0;
  for (let index = 0; index < total; index += 1) {
    const { text, signals } = generateMessage(random);
    const expected = referenceRateLimited(signals, keywords);
    const actual = classifyRetryableEnvironmentFailure(text) === "rate_limited";
    if (expected) hits += 1;
    if (expected !== actual) mismatches += 1;
  }
  return { mismatches, hits };
}

describe("F3①: classification vs AC1 reference (seed 79804, 10,000 messages)", () => {
  it("the judge catches a planted defect (reference without trial_rate_limited)", () => {
    const planted = judgeClassification(AC1_KEYWORDS.filter((keyword) => keyword !== "trial_rate_limited"), 79804, 10_000);
    console.info(`[F3①] planted defect mismatches=${planted.mismatches}`);
    expect(planted.mismatches).toBeGreaterThan(0);
  });

  it("every message agrees with the reference", () => {
    const result = judgeClassification(AC1_KEYWORDS, 79804, 10_000);
    console.info(`[F3①] messages=10000 hits=${result.hits} mismatches=${result.mismatches}`);
    expect(result.hits).toBeGreaterThan(1000);
    expect(result.mismatches).toBe(0);
  });
});

// ── F3②: rerun time ─────────────────────────────────────────────────────────

type TimeFormat = "none" | "iso" | "unix" | "escaped" | "in_seconds" | "retry_after";

interface TimeCase { message: string; now: Date; count: number; random: number; serverMs?: number }

function generateTimeCase(random: () => number): TimeCase {
  const now = new Date(Date.UTC(2026, 0, 1) + Math.floor(random() * 365 * 86_400_000));
  const format = pick<TimeFormat>(random, ["none", "iso", "unix", "escaped", "in_seconds", "retry_after"]);
  const offsetSeconds = Math.floor(random() * 3 * 3600);
  const serverMs = now.getTime() + offsetSeconds * 1000;
  const count = 1 + Math.floor(random() * 6);
  const jitter = random();
  const serverIso = new Date(serverMs).toISOString();
  const bodies: Record<TimeFormat, string> = {
    none: "usage_limit_reached: try again later",
    iso: `RunAI account rate limited (HTTP 429) resets_at=${serverIso}`,
    // unix seconds: whole seconds only
    unix: `{"error":{"type":"rate_limit_error","resets_at":${Math.floor(serverMs / 1000)}}}`,
    escaped: escapeLayers(JSON.stringify({ resets_at: serverIso }), 2),
    in_seconds: `rate_limit_error resets_in_seconds: ${offsetSeconds}`,
    retry_after: `HTTP 429 retry-after: ${offsetSeconds}`,
  };
  const exactServerMs = format === "unix" ? Math.floor(serverMs / 1000) * 1000 : serverMs;
  return {
    message: bodies[format],
    now,
    count,
    random: jitter,
    serverMs: format === "none" ? undefined : Math.max(exactServerMs, now.getTime()),
  };
}

const BACKOFF_MINUTES = (count: number) => (count <= 1 ? 5 : count === 2 ? 10 : 20);

/** AC6: server time → [t, t + 60 s]; no server time → 5/10/20 min × [0.8, 1.2]. */
function withinAc6(testCase: TimeCase, retryAtMs: number): boolean {
  if (testCase.serverMs !== undefined) {
    return retryAtMs >= testCase.serverMs && retryAtMs <= testCase.serverMs + 60_000;
  }
  const base = BACKOFF_MINUTES(testCase.count) * 60_000;
  const delay = retryAtMs - testCase.now.getTime();
  return delay >= base * 0.8 && delay <= base * 1.2;
}

function judgeTimes(compute: typeof computeRateLimitRetryAt, seed: number, total: number): number {
  const random = mulberry32(seed);
  let violations = 0;
  for (let index = 0; index < total; index += 1) {
    const testCase = generateTimeCase(random);
    const retryAt = compute({ message: testCase.message, consecutiveCount: testCase.count, now: testCase.now, random: () => testCase.random });
    if (!withinAc6(testCase, retryAt.getTime())) violations += 1;
  }
  return violations;
}

describe("F3②: rerun time vs AC6 reference (seed 2026, 10,000 cases)", () => {
  it("the judge catches a planted defect (jitter allowed 1 s early)", () => {
    const early: typeof computeRateLimitRetryAt = (params) => new Date(computeRateLimitRetryAt(params).getTime() - 1_000);
    const violations = judgeTimes(early, 2026, 10_000);
    console.info(`[F3②] planted defect violations=${violations}`);
    expect(violations).toBeGreaterThan(0);
  });

  it("every case lands in the AC6 window", () => {
    const violations = judgeTimes(computeRateLimitRetryAt, 2026, 10_000);
    console.info(`[F3②] cases=10000 violations=${violations}`);
    expect(violations).toBe(0);
  });
});
