import type { Task } from "../models/task";
import type { TaskStore } from "../store/task-store";
import { appendTaskComment, appendTaskCommentEntry } from "./task-comment-log";

/**
 * Referential cleanup for card deletion.
 *
 * Dependencies live in two layers with no referential integrity:
 * - the structured `task.dependencies` array (feeds /api/tasks/ready), and
 * - agent-authored canonical YAML `depends_on` text inside `task.objective`.
 *
 * Deleting a card must not silently strand its referrers: structured arrays
 * are cleaned automatically, while YAML mentions only receive an audit
 * comment — machine-editing an agent-authored (and possibly frozen) story
 * contract is not safe. See
 * docs/issues/2026-09-21-card-deletion-leaves-dangling-dependency-references.md
 */
export interface DanglingDependencyCleanupResult {
  /** Tasks whose structured `dependencies` array referenced the deleted card. */
  structuralReferrerIds: string[];
  /** Tasks whose objective (canonical YAML) mentions the deleted card id. */
  yamlMentionTaskIds: string[];
  /** Every task that was modified (cleaned and/or annotated) and saved. */
  updatedTaskIds: string[];
}

export function buildDeletedDependencyNote(deletedTask: Pick<Task, "id" | "title">, options?: {
  yamlMention?: boolean;
}): string {
  const base =
    `Dependency card ${deletedTask.id} ("${deletedTask.title}") was deleted. ` +
    "Its id was removed from this card's structured dependencies.";
  if (!options?.yamlMention) {
    return base;
  }
  return (
    `Dependency card ${deletedTask.id} ("${deletedTask.title}") was deleted. ` +
    "This card's canonical YAML (depends_on / unblock_condition) still mentions that id; " +
    "refresh the story during the next backlog pass and point it at the replacement card, if any."
  );
}

export async function cleanupDanglingDependencyReferences(params: {
  deletedTask: Pick<Task, "id" | "title" | "workspaceId">;
  taskStore: TaskStore;
  /** Optional change notifier, called once per updated task. */
  onTaskUpdated?: (task: Task) => void;
}): Promise<DanglingDependencyCleanupResult> {
  const { deletedTask, taskStore, onTaskUpdated } = params;
  const result: DanglingDependencyCleanupResult = {
    structuralReferrerIds: [],
    yamlMentionTaskIds: [],
    updatedTaskIds: [],
  };

  const workspaceTasks = await taskStore.listByWorkspace(deletedTask.workspaceId);
  for (const task of workspaceTasks) {
    if (task.id === deletedTask.id) {
      continue;
    }

    const hasStructuralRef = Array.isArray(task.dependencies)
      && task.dependencies.includes(deletedTask.id);
    // Card ids are UUIDs; a plain substring match cannot realistically false-positive.
    const hasYamlMention = typeof task.objective === "string"
      && task.objective.includes(deletedTask.id);

    if (!hasStructuralRef && !hasYamlMention) {
      continue;
    }

    if (hasStructuralRef) {
      result.structuralReferrerIds.push(task.id);
      task.dependencies = task.dependencies.filter((id) => id !== deletedTask.id);
    }
    if (hasYamlMention) {
      result.yamlMentionTaskIds.push(task.id);
    }

    const note = buildDeletedDependencyNote(deletedTask, { yamlMention: hasYamlMention });
    task.comment = appendTaskComment(task.comment, note);
    task.comments = appendTaskCommentEntry(task.comments, note, { source: undefined });
    task.updatedAt = new Date();
    await taskStore.save(task);
    result.updatedTaskIds.push(task.id);
    onTaskUpdated?.(task);
  }

  return result;
}
