// @vitest-environment node
/**
 * Card 79804de2, contract C1/C2: classification of retryable environment
 * failures (rate limits), the planned rerun time and the lastSyncError text.
 * Expected values are written as literals worked out from AC1/AC6/AC8.
 */
process.env.TZ = "Asia/Shanghai";

import { describe, expect, it } from "vitest";

import {
  classifyRetryableEnvironmentFailure,
  computeRateLimitRetryAt,
  formatRateLimitedError,
  formatRetryableEnvironmentFuseError,
  getConsecutiveRetryableEnvironmentFailureCount,
  hasTrippedRetryableEnvironmentFuse,
  isAwaitingEnvironmentFix,
  isEnvironmentFailureMessage,
  isRetryableEnvironmentReason,
  isWaitingForRateLimitRetry,
  parseRateLimitResetAt,
} from "../environment-failure";
import type { TaskLaneSession, TaskLaneSessionRecoveryReason } from "../../models/task";

/** Production text ① (routa.db, 2026-10-23). */
const ONLINE_RUNAI_429 = '{"type":"error","error":{"type":"rate_limit_error","message":"RunAI account rate limited (HTTP 429, rate_limit_error; upstream trial_rate_limited) resets_at=2026-10-23T09:56:07.846Z"}}';
/** Production text ② shape: multi-escaped JSON, usage_limit_reached, no reset time. */
const ONLINE_USAGE_LIMIT = String.raw`Internal error: {"error":"{\"message\":\"{\\\"error\\\":{\\\"type\\\":\\\"usage_limit_reached\\\",\\\"code\\\":\\\"trial_rate_limited\\\",\\\"message\\\":\\\"The usage limit has been reached\\\"}}\"}"}`;

const POSITIVE: Array<[string, string]> = [
  ["online text ① (resets_at, HTTP 429)", ONLINE_RUNAI_429],
  ["online text ② (multi-escaped usage_limit_reached)", ONLINE_USAGE_LIMIT],
  ["HTTP/1.1 status line", "HTTP/1.1 429 Too Many Requests"],
  ["JSON status field", '{"status":429,"message":"slow down"}'],
  ["bare rate_limit_error", "rate_limit_error"],
  ["usage_limit_reached", "usage_limit_reached"],
  ["trial_rate_limited", "upstream trial_rate_limited"],
  ["status 429", "request failed with status 429"],
];

const NEGATIVE: Array<[string, unknown]> = [
  ["boom", "boom"],
  ["ACP create failure", "Failed to create ACP session."],
  ["row count", "processed 429 rows"],
  ["port", "listening on port 4290"],
  ["empty", ""],
  ["undefined", undefined],
  ["plain agent failure", "ACP session failed: tool call exited with code 1"],
  ["watchdog text", "No ACP activity for 10 minutes."],
  ["provider not registered", 'Unknown provider: "dsh". Not registered in ProviderRegistry: dsh'],
  ["status 4290", "status: 4290"],
];

describe("C1: retryable environment failure classification", () => {
  it.each(POSITIVE)("rate_limited: %s", (_label, text) => {
    expect(classifyRetryableEnvironmentFailure(text)).toBe("rate_limited");
  });

  it.each(NEGATIVE)("not rate_limited: %s", (_label, text) => {
    expect(classifyRetryableEnvironmentFailure(text)).toBeUndefined();
  });

  it("provider not registered stays a non-retryable environment failure", () => {
    const text = "Not registered in ProviderRegistry: dsh";
    expect(isEnvironmentFailureMessage(text)).toBe(true);
    expect(classifyRetryableEnvironmentFailure(text)).toBeUndefined();
    expect(isAwaitingEnvironmentFix({
      laneSessions: [lane("dev", "environment_failure", "failed")],
    }, "dev")).toBe(true);
  });

  it.each<TaskLaneSessionRecoveryReason>(["rate_limited", "turn_cancelled", "restart_interrupted"])(
    "%s is retryable and never awaits an environment fix",
    (reason) => {
      expect(isRetryableEnvironmentReason(reason)).toBe(true);
      expect(isAwaitingEnvironmentFix({ laneSessions: [lane("dev", reason, "failed")] }, "dev")).toBe(false);
    },
  );

  it.each<TaskLaneSessionRecoveryReason>(["environment_failure", "agent_failed", "watchdog_inactivity", "completion_criteria_not_met"])(
    "%s is not retryable",
    (reason) => {
      expect(isRetryableEnvironmentReason(reason)).toBe(false);
    },
  );
});

const NOW = new Date("2026-10-23T09:50:00.000Z");

describe("C2: planned rerun time", () => {
  const serverCases: Array<{ label: string; text: string; server: string }> = [
    { label: "(a) resets_at=ISO", text: ONLINE_RUNAI_429, server: "2026-10-23T09:56:07.846Z" },
    { label: "(b) resets_at unix seconds", text: '{"resets_at":1792749600}', server: "2026-10-23T10:00:00.000Z" },
    {
      label: "(c) multi-escaped resets_at",
      text: String.raw`{\\\"resets_at\\\":\\\"2026-10-23T10:05:00.000Z\\\"}`,
      server: "2026-10-23T10:05:00.000Z",
    },
    { label: "(d) resets_in_seconds", text: "rate limited, resets_in_seconds: 300", server: "2026-10-23T09:55:00.000Z" },
    { label: "(e) retry-after", text: "HTTP 429; retry-after: 120", server: "2026-10-23T09:52:00.000Z" },
  ];

  it.each(serverCases)("$label parses the server time", ({ text, server }) => {
    expect(parseRateLimitResetAt(text, NOW)?.toISOString()).toBe(server);
  });

  it.each(serverCases)("$label: retryAt in [server, server + 60 s], never earlier", ({ text, server }) => {
    const serverMs = Date.parse(server);
    const at = (random: number) => computeRateLimitRetryAt({ message: text, consecutiveCount: 1, now: NOW, random: () => random }).getTime();
    expect(at(0)).toBe(serverMs);
    expect(at(0.5)).toBe(serverMs + 30_000);
    expect(at(0.999)).toBe(serverMs + 59_940);
    for (const random of [0, 0.5, 0.999]) {
      expect(at(random)).toBeGreaterThanOrEqual(serverMs);
      expect(at(random)).toBeLessThanOrEqual(serverMs + 60_000);
    }
  });

  const backoff: Array<{ count: number; minutes: number }> = [
    { count: 1, minutes: 5 },
    { count: 2, minutes: 10 },
    { count: 3, minutes: 20 },
    { count: 4, minutes: 20 },
  ];

  it.each(backoff)("(f) no reset time, failure #$count: $minutes min ±20%", ({ count, minutes }) => {
    const delay = (random: number) => computeRateLimitRetryAt({
      message: ONLINE_USAGE_LIMIT,
      consecutiveCount: count,
      now: NOW,
      random: () => random,
    }).getTime() - NOW.getTime();
    const base = minutes * 60_000;
    expect(delay(0)).toBe(base * 0.8);
    expect(delay(0.5)).toBe(base);
    expect(delay(0.999)).toBe(Math.round(base * 1.1996));
    for (const random of [0, 0.5, 0.999]) {
      expect(delay(random)).toBeGreaterThanOrEqual(base * 0.8);
      expect(delay(random)).toBeLessThanOrEqual(base * 1.2);
    }
  });

  it("a server time already in the past reruns from now", () => {
    const at = computeRateLimitRetryAt({
      message: "resets_at=2026-10-23T09:00:00.000Z",
      consecutiveCount: 1,
      now: NOW,
      random: () => 0,
    });
    expect(at.toISOString()).toBe("2026-10-23T09:50:00.000Z");
  });
});

describe("C2/AC8: lastSyncError text", () => {
  it("(a) random=0 shows the local Asia/Shanghai clock 17:56", () => {
    const retryAt = computeRateLimitRetryAt({ message: ONLINE_RUNAI_429, consecutiveCount: 1, now: NOW, random: () => 0 });
    const text = formatRateLimitedError(retryAt);
    expect(text).toBe("[environment] rate_limited：限流，预计 17:56 重试");
    expect(text.startsWith("[environment]")).toBe(true);
  });

  it("pads hours and minutes", () => {
    expect(formatRateLimitedError(new Date("2026-10-23T01:05:00.000Z"))).toBe("[environment] rate_limited：限流，预计 09:05 重试");
  });

  it("fuse text names the count", () => {
    expect(formatRetryableEnvironmentFuseError(5)).toBe("[environment] rate_limited：连续 5 次可重试环境失败，已熔断，停止自动重跑");
  });
});

describe("C6: consecutive count and fuse", () => {
  it("counts the streak at the end of the column and stops at a success or a real failure", () => {
    const four = Array.from({ length: 4 }, () => lane("dev", "rate_limited", "failed"));
    expect(getConsecutiveRetryableEnvironmentFailureCount({ laneSessions: [...four, lane("dev", "rate_limited", "failed")] }, "dev")).toBe(5);
    expect(hasTrippedRetryableEnvironmentFuse({ laneSessions: [...four, lane("dev", "rate_limited", "failed")] }, "dev")).toBe(true);
    expect(getConsecutiveRetryableEnvironmentFailureCount({
      laneSessions: [...four, lane("dev", undefined, "completed"), ...four],
    }, "dev")).toBe(4);
    expect(getConsecutiveRetryableEnvironmentFailureCount({
      laneSessions: [...four, lane("dev", "agent_failed", "failed"), ...four],
    }, "dev")).toBe(4);
    expect(getConsecutiveRetryableEnvironmentFailureCount({
      laneSessions: [
        lane("dev", "rate_limited", "failed"),
        lane("dev", "rate_limited", "failed"),
        lane("dev", "rate_limited", "failed"),
        lane("dev", "restart_interrupted", "timed_out"),
        lane("dev", "restart_interrupted", "timed_out"),
      ],
    }, "dev")).toBe(5);
    expect(getConsecutiveRetryableEnvironmentFailureCount({
      laneSessions: [...four, lane("review", "rate_limited", "failed")],
    }, "review")).toBe(1);
    expect(hasTrippedRetryableEnvironmentFuse({ laneSessions: four }, "dev")).toBe(false);
  });

  it("waits for the rate-limit rerun only while retryAfterAt is in the future", () => {
    const pending = { ...lane("done", "rate_limited", "failed"), retryAfterAt: "2026-10-23T10:00:00.000Z" };
    expect(isWaitingForRateLimitRetry({ laneSessions: [pending] }, "done", NOW)).toBe(true);
    expect(isWaitingForRateLimitRetry({ laneSessions: [pending] }, "done", new Date("2026-10-23T10:00:00.001Z"))).toBe(false);
    expect(isWaitingForRateLimitRetry({ laneSessions: [lane("done", "agent_failed", "failed")] }, "done", NOW)).toBe(false);
  });
});

let laneCounter = 0;
function lane(
  columnId: string,
  recoveryReason: TaskLaneSessionRecoveryReason | undefined,
  status: TaskLaneSession["status"],
): TaskLaneSession {
  laneCounter += 1;
  return {
    sessionId: `s-${laneCounter}`,
    columnId,
    stepIndex: 0,
    recoveryReason,
    status,
    startedAt: "2026-10-23T08:00:00.000Z",
  };
}
