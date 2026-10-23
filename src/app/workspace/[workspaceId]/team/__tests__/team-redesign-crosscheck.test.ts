import { describe, expect, it } from "vitest";

import { matchesSessionQuery } from "../../sessions-overview";
import { findCoordinatorSession, selectCoordinators, sortTeamRuns, type CoordinatorAgent } from "../team-page-model";
import { buildTeamRunName } from "../team-run-name";

/**
 * F3 random cross-checks. Each judge is written from the requirement, not by
 * calling the implementation. A seeded PRNG keeps every run reproducible.
 */
function prng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SAMPLES = 10_000;
const ALPHABET = "abcABC-_ 01";

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)];
}

function randomText(rand: () => number, maxLength: number, alphabet = ALPHABET): string {
  const length = Math.floor(rand() * (maxLength + 1));
  let out = "";
  for (let i = 0; i < length; i += 1) out += pick(rand, alphabet.split(""));
  return out;
}

/** Judge for search + sort: filter by "name contains or id starts with", then order by time, ties by id ascending. */
function judgeRuns(runs: Array<{ sessionId: string; name?: string; createdAt: string }>, query: string, direction: "asc" | "desc", fallback: string) {
  const needle = query.trim().toLowerCase();
  const kept = runs.filter((run) => !needle
    || (run.name || fallback).toLowerCase().includes(needle)
    || run.sessionId.toLowerCase().startsWith(needle));
  const out: typeof kept = [];
  for (const run of kept) {
    let index = 0;
    while (index < out.length) {
      const other = out[index];
      const a = Date.parse(run.createdAt);
      const b = Date.parse(other.createdAt);
      const before = a === b ? run.sessionId < other.sessionId : direction === "desc" ? a > b : a < b;
      if (before) break;
      index += 1;
    }
    out.splice(index, 0, run);
  }
  return out.map((run) => run.sessionId);
}

describe("F3 random cross-check", () => {
  it("search + sort matches the requirement judge on 10,000 random samples", () => {
    const rand = prng(20261023);
    const fallback = "Unnamed";
    for (let sample = 0; sample < SAMPLES; sample += 1) {
      const count = Math.floor(rand() * 31);
      const ids = new Set<string>();
      const runs = Array.from({ length: count }, () => {
        let id = `${randomText(rand, 4, "abc")}-${Math.floor(rand() * 1000)}`;
        while (ids.has(id)) id += "x";
        ids.add(id);
        const day = 1 + Math.floor(rand() * 5);
        return {
          sessionId: id,
          workspaceId: "w",
          cwd: "",
          name: rand() < 0.2 ? undefined : randomText(rand, 12),
          createdAt: `2026-10-0${day}T00:00:00.000Z`,
        };
      });
      const query = rand() < 0.3 ? "" : randomText(rand, 3);
      const direction = rand() < 0.5 ? "asc" : "desc";
      const actual = sortTeamRuns(runs.filter((run) => matchesSessionQuery(run, query, fallback)), direction).map((run) => run.sessionId);
      const expected = judgeRuns(runs, query, direction, fallback);
      if (actual.join("|") !== expected.join("|")) {
        throw new Error(`sample ${sample} mismatch: query=${JSON.stringify(query)} dir=${direction}\nactual=${actual}\nexpected=${expected}`);
      }
    }
    expect(true).toBe(true);
  });

  it("buildTeamRunName keeps the backend team-run prefix on 10,000 random requirements", () => {
    const rand = prng(42);
    const alphabet = "abc XYZ\t\n修复登录🚀-:";
    for (let sample = 0; sample < SAMPLES; sample += 1) {
      const requirement = rand() < 0.05 ? " ".repeat(Math.floor(rand() * 4)) : randomText(rand, 90, alphabet);
      const name = buildTeamRunName(requirement);
      const lower = name.toLowerCase();
      const normalized = requirement.replace(/\s+/g, " ").trim();
      const ok = (lower.startsWith("team -") || lower.startsWith("team run"))
        && name.length <= 7 + 56
        && (normalized ? name.startsWith("Team - ") : name === "Team run");
      if (!ok) throw new Error(`sample ${sample}: ${JSON.stringify(requirement)} -> ${JSON.stringify(name)}`);
    }
    expect(true).toBe(true);
  });

  it("coordinator linking matches routaAgentId only on 10,000 random graphs", () => {
    const rand = prng(7);
    for (let sample = 0; sample < SAMPLES; sample += 1) {
      const agents: CoordinatorAgent[] = Array.from({ length: Math.floor(rand() * 6) }, (_, i) => ({
        id: `agent-${sample}-${i}`,
        name: `routa-coordinator-${i}`,
        role: pick(rand, ["ROUTA", "CRAFTER", "routa"]),
        createdAt: `2026-10-0${1 + Math.floor(rand() * 5)}T00:00:00.000Z`,
      }));
      const agentIds = [...agents.map((a) => a.id), "ghost-agent"];
      const makeSession = (prefix: string, i: number) => ({
        sessionId: `${prefix}-${i}`,
        routaAgentId: rand() < 0.6 ? pick(rand, agentIds) : undefined,
      });
      const teamRuns = Array.from({ length: Math.floor(rand() * 4) }, (_, i) => makeSession("run", i));
      const all = Array.from({ length: Math.floor(rand() * 6) }, (_, i) => makeSession("ses", i));

      const coordinators = selectCoordinators(agents);
      const expectedIds = agents.filter((a) => a.role.toUpperCase() === "ROUTA").map((a) => a.id).sort();
      expect([...coordinators.map((a) => a.id)].sort()).toEqual(expectedIds);
      for (let i = 1; i < coordinators.length; i += 1) {
        expect(Date.parse(coordinators[i - 1].createdAt)).toBeGreaterThanOrEqual(Date.parse(coordinators[i].createdAt));
      }
      for (const agent of coordinators) {
        let expected: string | undefined;
        for (const run of teamRuns) if (!expected && run.routaAgentId === agent.id) expected = run.sessionId;
        for (const session of all) if (!expected && session.routaAgentId === agent.id) expected = session.sessionId;
        const actual = findCoordinatorSession(agent.id, teamRuns, all)?.sessionId;
        if (actual !== expected) throw new Error(`sample ${sample} agent ${agent.id}: actual=${actual} expected=${expected}`);
      }
    }
    expect(true).toBe(true);
  });
});
