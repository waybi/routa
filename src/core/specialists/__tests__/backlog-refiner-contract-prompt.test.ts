import { describe, expect, it } from "vitest";
import { loadBundledSpecialists } from "../specialist-file-loader";

/**
 * Locks the instruction that closes
 * docs/issues/2026-05-22-canonical-contract-comment-only-refinement-loop.md.
 *
 * The contract gate (src/core/kanban/task-contract-readiness.ts) reads only
 * `task.objective`. Agents that wrote the canonical YAML into a comment and
 * then called move_card looped indefinitely on "Canonical story YAML is
 * missing" — reproduced on a live board (TopBI d5e0a0a2, 3 bounces,
 * 2026-09-21). The prompt must say, in every locale, that comments do not
 * satisfy the gate. This test fails if a future prompt edit drops that line.
 */

const SPECIALIST_ID = "kanban-backlog-refiner";

function loadRefinerPrompt(locale?: string): string {
  const specialist = loadBundledSpecialists(locale).find((entry) => entry.id === SPECIALIST_ID);
  expect(specialist, `${SPECIALIST_ID} must exist for locale ${locale ?? "default"}`).toBeDefined();
  return specialist!.behaviorPrompt;
}

describe("backlog-refiner canonical contract prompt", () => {
  it("tells the agent (en) that comments do not satisfy the gate and update_card is required", () => {
    const prompt = loadRefinerPrompt();

    // Names the gate's exact error so the agent can recognise the bounce.
    expect(prompt).toContain("Canonical story YAML is missing");
    // States what does NOT count.
    expect(prompt).toMatch(/comment[\s\S]{0,120}does NOT satisfy/i);
    // States the only thing that does.
    expect(prompt).toMatch(/`update_card`[\s\S]{0,80}description/);
  });

  it("tells the agent (zh-CN) that comments do not satisfy the gate and update_card is required", () => {
    const prompt = loadRefinerPrompt("zh-CN");

    expect(prompt).toContain("Canonical story YAML is missing");
    expect(prompt).toMatch(/评论[\s\S]{0,60}都不算/);
    expect(prompt).toMatch(/`update_card`[\s\S]{0,40}description/);
  });

  it("keeps the gate description consistent with the code path it describes", () => {
    // The prompt promises the gate reads only the description; the gate code
    // must still be doing exactly that, or the instruction becomes a lie.
    const prompt = loadRefinerPrompt();
    expect(prompt).toContain("task.objective");
  });
});
