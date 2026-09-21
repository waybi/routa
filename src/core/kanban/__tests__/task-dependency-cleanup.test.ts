/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest";
import { InMemoryTaskStore } from "../../store/task-store";
import { createTask } from "../../models/task";
import { cleanupDanglingDependencyReferences } from "../task-dependency-cleanup";

describe("cleanupDanglingDependencyReferences", () => {
  const DELETED_ID = "11111111-2222-3333-4444-555555555555";

  function deletedTask() {
    return { id: DELETED_ID, title: "Deleted card", workspaceId: "ws-1" };
  }

  it("removes the deleted id from structured dependencies and appends an audit comment", async () => {
    const taskStore = new InMemoryTaskStore();
    const referrer = createTask({
      id: "referrer-structural",
      title: "Depends structurally",
      objective: "Plain objective without mention",
      workspaceId: "ws-1",
      dependencies: [DELETED_ID, "some-other-card"],
    });
    await taskStore.save(referrer);

    const result = await cleanupDanglingDependencyReferences({
      deletedTask: deletedTask(),
      taskStore,
    });

    expect(result.structuralReferrerIds).toEqual(["referrer-structural"]);
    expect(result.updatedTaskIds).toEqual(["referrer-structural"]);
    expect(result.yamlMentionTaskIds).toEqual([]);

    const persisted = await taskStore.get("referrer-structural");
    expect(persisted?.dependencies).toEqual(["some-other-card"]);
    expect(persisted?.comment).toContain(DELETED_ID);
    expect(persisted?.comment).toContain("was deleted");
    expect(persisted?.comments?.at(-1)?.body).toContain("was deleted");
  });

  it("annotates canonical YAML mentions without rewriting the objective", async () => {
    const taskStore = new InMemoryTaskStore();
    const objective = [
      "```yaml",
      "story:",
      "  dependencies_and_sequencing:",
      "    depends_on:",
      `      - "${DELETED_ID}"`,
      "```",
    ].join("\n");
    const referrer = createTask({
      id: "referrer-yaml",
      title: "Depends via YAML",
      objective,
      workspaceId: "ws-1",
    });
    await taskStore.save(referrer);

    const result = await cleanupDanglingDependencyReferences({
      deletedTask: deletedTask(),
      taskStore,
    });

    expect(result.yamlMentionTaskIds).toEqual(["referrer-yaml"]);
    expect(result.structuralReferrerIds).toEqual([]);

    const persisted = await taskStore.get("referrer-yaml");
    // Objective (canonical YAML) must stay untouched.
    expect(persisted?.objective).toBe(objective);
    expect(persisted?.comment).toContain("canonical YAML");
    expect(persisted?.comment).toContain("backlog pass");
  });

  it("leaves unrelated tasks untouched and reports every updated task", async () => {
    const taskStore = new InMemoryTaskStore();
    const unrelated = createTask({
      id: "unrelated",
      title: "No reference",
      objective: "Nothing to see",
      workspaceId: "ws-1",
      dependencies: ["another-card"],
    });
    const both = createTask({
      id: "referrer-both",
      title: "Structural and YAML",
      objective: `depends_on: ${DELETED_ID}`,
      workspaceId: "ws-1",
      dependencies: [DELETED_ID],
    });
    await taskStore.save(unrelated);
    await taskStore.save(both);

    const updatedIds: string[] = [];
    const result = await cleanupDanglingDependencyReferences({
      deletedTask: deletedTask(),
      taskStore,
      onTaskUpdated: (task) => updatedIds.push(task.id),
    });

    expect(result.structuralReferrerIds).toEqual(["referrer-both"]);
    expect(result.yamlMentionTaskIds).toEqual(["referrer-both"]);
    expect(result.updatedTaskIds).toEqual(["referrer-both"]);
    expect(updatedIds).toEqual(["referrer-both"]);

    const untouched = await taskStore.get("unrelated");
    expect(untouched?.dependencies).toEqual(["another-card"]);
    expect(untouched?.comment ?? "").toBe("");
  });
});
