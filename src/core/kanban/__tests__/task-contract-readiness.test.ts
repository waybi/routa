import { describe, expect, it } from "vitest";

import { createTask } from "@/core/models/task";
import {
  buildTaskContractReadiness,
  buildTaskContractTransitionErrorFromRules,
  buildTaskContractUpdateErrorFromRules,
  countContractGateFailures,
  detectMisplacedCanonicalYaml,
  MISPLACED_CANONICAL_YAML_ISSUE,
  resolveCurrentOrNextContractGate,
} from "../task-contract-readiness";

describe("task contract readiness", () => {
  const validObjective = `Summary

\`\`\`yaml
story:
  version: 1
  language: en
  title: Valid story
  problem_statement: Users need a stable contract.
  user_value: Downstream lanes can trust the story.
  acceptance_criteria:
    - id: AC1
      text: Story parses cleanly.
      testable: true
    - id: AC2
      text: Contract includes the required schema.
      testable: true
  constraints_and_affected_areas:
    - src/app/page.tsx
  dependencies_and_sequencing:
    independent_story_check: pass
    depends_on: []
    unblock_condition: Ready now.
  out_of_scope:
    - unrelated work
  invest:
    independent:
      status: pass
      reason: No blocking prerequisite.
    negotiable:
      status: pass
      reason: Delivery details can still evolve.
    valuable:
      status: pass
      reason: Users get a reliable plan.
    estimable:
      status: pass
      reason: Scope is concrete.
    small:
      status: pass
      reason: One delivery slice.
    testable:
      status: pass
      reason: ACs are explicit.
\`\`\`
`;

  it("accepts a valid canonical story when the gate is enabled", () => {
    const task = createTask({
      id: "task-contract-ok",
      title: "Contract gate",
      objective: validObjective,
      workspaceId: "default",
    });

    const readiness = buildTaskContractReadiness(task, {
      requireCanonicalStory: true,
      loopBreakerThreshold: 2,
    });

    expect(readiness.checked).toBe(true);
    expect(readiness.ready).toBe(true);
    expect(readiness.issues).toEqual([]);
  });

  it("reports missing canonical YAML as a transition and update error", () => {
    const task = createTask({
      id: "task-contract-missing",
      title: "Missing contract",
      objective: "No canonical YAML yet",
      workspaceId: "default",
    });

    const rules = { requireCanonicalStory: true, loopBreakerThreshold: 2 };
    const readiness = buildTaskContractReadiness(task, rules);

    expect(readiness.ready).toBe(false);
    expect(buildTaskContractTransitionErrorFromRules(readiness, "Todo", rules)).toContain(
      'Cannot move task to "Todo": Canonical story YAML is missing.',
    );
    expect(buildTaskContractUpdateErrorFromRules(readiness, "Todo", rules)).toContain(
      "Cannot update card description: Canonical story YAML is missing.",
    );
  });

  it("resolves the current-or-next contract gate for backlog cards", () => {
    const gate = resolveCurrentOrNextContractGate([
      { id: "backlog", name: "Backlog", automation: { enabled: true } },
      {
        id: "todo",
        name: "Todo",
        automation: {
          enabled: true,
          contractRules: {
            requireCanonicalStory: true,
            loopBreakerThreshold: 2,
          },
        },
      },
    ], "backlog");

    expect(gate).toEqual({
      columnName: "Todo",
      rules: {
        requireCanonicalStory: true,
        loopBreakerThreshold: 2,
      },
    });
  });

  it("counts prior contract gate notes for loop breaking", () => {
    const task = createTask({
      id: "task-contract-loop",
      title: "Loop count",
      objective: validObjective,
      workspaceId: "default",
      comments: [
        {
          id: "note-1",
          body: 'Contract gate blocked: Cannot move task to "Todo": canonical story YAML is invalid.',
          createdAt: new Date().toISOString(),
        },
        {
          id: "note-2",
          body: "Normal progress note",
          createdAt: new Date().toISOString(),
          source: "update_card",
        },
      ],
    });

    expect(countContractGateFailures(task)).toBe(1);
  });

  describe("misplaced canonical YAML (in a comment, not the description)", () => {
    // TopBI card d5e0a0a2 bounced 3x on 2026-09-21 exactly this way: the
    // agent wrote a valid story into a comment, got "YAML is missing",
    // regenerated it into another comment, repeat.
    const rules = { requireCanonicalStory: true, loopBreakerThreshold: 2 };

    function taskWithYamlInComment() {
      return createTask({
        id: "task-misplaced",
        title: "Misplaced YAML",
        objective: "Just a prose summary, no YAML here.",
        workspaceId: "default",
        comments: [
          { id: "c-1", body: "Starting refinement.", createdAt: new Date().toISOString() },
          { id: "c-2", body: `Refined story:\n\n${validObjective}`, createdAt: new Date().toISOString(), source: "update_card" },
        ],
      });
    }

    it("detects a parseable story block in any comment", () => {
      expect(detectMisplacedCanonicalYaml(taskWithYamlInComment())).toBe(true);
    });

    it("does not fire when no comment has a story block", () => {
      const task = createTask({
        id: "task-no-yaml-anywhere",
        title: "Nothing",
        objective: "prose",
        workspaceId: "default",
        comments: [{ id: "c", body: "Contract gate blocked: something", createdAt: new Date().toISOString() }],
      });
      expect(detectMisplacedCanonicalYaml(task)).toBe(false);
    });

    it("does not fire for a comment whose yaml block is not a canonical story", () => {
      const task = createTask({
        id: "task-other-yaml",
        title: "Other yaml",
        objective: "prose",
        workspaceId: "default",
        comments: [{ id: "c", body: "```yaml\nfoo: bar\n```", createdAt: new Date().toISOString() }],
      });
      expect(detectMisplacedCanonicalYaml(task)).toBe(false);
    });

    it("replaces the generic 'missing' message with a targeted one and drops the regenerate suffix", () => {
      const readiness = buildTaskContractReadiness(taskWithYamlInComment(), rules);

      expect(readiness.ready).toBe(false);
      expect(readiness.hasCanonicalStoryBlock).toBe(false);
      expect(readiness.misplacedYamlInComment).toBe(true);
      expect(readiness.issues[0]).toBe(MISPLACED_CANONICAL_YAML_ISSUE);

      const error = buildTaskContractTransitionErrorFromRules(readiness, "Todo", rules);
      expect(error).toContain("in a comment, not in the card description");
      expect(error).toContain("`update_card`");
      // The generic suffix is what sent agents back to regenerate into the same comment.
      expect(error).not.toContain("Regenerate the canonical YAML");
      expect(error).not.toContain("Canonical story YAML is missing");
    });

    it("leaves the generic message alone when the YAML is truly absent", () => {
      const task = createTask({
        id: "task-truly-missing",
        title: "Truly missing",
        objective: "prose",
        workspaceId: "default",
        comments: [{ id: "c", body: "no yaml here either", createdAt: new Date().toISOString() }],
      });
      const readiness = buildTaskContractReadiness(task, rules);
      expect(readiness.misplacedYamlInComment).toBeUndefined();
      expect(buildTaskContractTransitionErrorFromRules(readiness, "Todo", rules)).toContain(
        "Canonical story YAML is missing",
      );
    });

    it("is not triggered when the description already has the YAML", () => {
      const task = createTask({
        id: "task-ok-plus-comment",
        title: "OK",
        objective: validObjective,
        workspaceId: "default",
        comments: [{ id: "c", body: validObjective, createdAt: new Date().toISOString() }],
      });
      const readiness = buildTaskContractReadiness(task, rules);
      expect(readiness.ready).toBe(true);
      expect(readiness.misplacedYamlInComment).toBeUndefined();
    });

    it("still works for callers that only pass objective (write guard)", () => {
      const readiness = buildTaskContractReadiness({ objective: "prose" }, rules);
      expect(readiness.ready).toBe(false);
      expect(readiness.misplacedYamlInComment).toBeUndefined();
    });

    it("does not let the gate note itself count as misplaced YAML", () => {
      // After a bounce, the gate appends its own message as a comment. That
      // comment mentions YAML but contains no block; it must not flip the
      // detector on the next attempt.
      const task = createTask({
        id: "task-gate-note",
        title: "Gate note",
        objective: "prose",
        workspaceId: "default",
        comments: [{
          id: "c",
          body: `Contract gate blocked: Cannot move task to "Todo": ${MISPLACED_CANONICAL_YAML_ISSUE}`,
          createdAt: new Date().toISOString(),
        }],
      });
      expect(detectMisplacedCanonicalYaml(task)).toBe(false);
    });
  });
});
