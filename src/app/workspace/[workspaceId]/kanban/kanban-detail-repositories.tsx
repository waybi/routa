"use client";

import { useState } from "react";
import type { CodebaseData } from "@/client/hooks/use-workspaces";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { useTranslation } from "@/i18n";
import type { SessionInfo, TaskInfo, WorktreeInfo } from "../types";
import { DetailSection } from "./kanban-detail-section";

/**
 * Linked repositories, worktree path/branch and the "does the session run
 * in this card's directory" check of the Construction tab. Moved out of
 * kanban-card-detail.tsx for the redesign (card 3/6).
 */
export function KanbanDetailRepositories({
  task,
  codebases,
  allCodebaseIds,
  worktreeCache,
  sessionInfo,
  sessionCwdMismatch,
  onPatchTask,
  onRefresh,
  onRepositoryChange,
  onSelectSession,
  compact = false,
}: {
  task: TaskInfo;
  codebases: CodebaseData[];
  allCodebaseIds: string[];
  worktreeCache: Record<string, WorktreeInfo>;
  sessionInfo?: SessionInfo | null;
  sessionCwdMismatch?: boolean;
  onPatchTask: (taskId: string, payload: Record<string, unknown>) => Promise<TaskInfo>;
  onRefresh: () => void;
  onRepositoryChange?: (codebaseIds: string[]) => void;
  onSelectSession?: (sessionId: string) => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const [updateError, setUpdateError] = useState<string | null>(null);
  const currentCodebaseIds = task.codebaseIds && task.codebaseIds.length > 0 ? task.codebaseIds : allCodebaseIds;
  const primaryCodebase = codebases.find((codebase) => codebase.id === currentCodebaseIds[0]);
  const worktree = task.worktreeId ? worktreeCache[task.worktreeId] : null;
  const expectedPath = worktree?.worktreePath ?? primaryCodebase?.repoPath ?? null;
  const effectiveBranch = sessionInfo?.branch ?? worktree?.branch ?? primaryCodebase?.branch ?? null;
  const sessionRepoCodebase = sessionInfo ? codebases.find((codebase) => codebase.repoPath === sessionInfo.cwd) : undefined;
  const canAdoptSessionRepo = Boolean(
    sessionCwdMismatch && sessionRepoCodebase && currentCodebaseIds[0] !== sessionRepoCodebase.id,
  );
  const repoSummary = primaryCodebase
    ? `${primaryCodebase.label ?? primaryCodebase.repoPath.split("/").pop()}${currentCodebaseIds.length > 1 ? ` +${currentCodebaseIds.length - 1}` : ""}`
    : t.kanbanDetail.noRepoLinked;
  const sessionIdToOpen = sessionInfo?.sessionId ?? task.triggerSessionId;

  const patchCodebases = async (nextCodebaseIds: string[], fallbackError: string) => {
    setUpdateError(null);
    try {
      await onPatchTask(task.id, { codebaseIds: nextCodebaseIds });
      onRepositoryChange?.(nextCodebaseIds);
      onRefresh();
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : fallbackError);
    }
  };

  return (
    <DetailSection
      title={t.kanbanDetail.repositories}
      description={compact ? undefined : t.kanbanDetail.repositoriesHint}
      compact={compact}
      testId="kanban-detail-repositories"
    >
      <details className="group rounded-md border border-default">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-3 py-2.5 text-sm hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
          <span className="text-xs text-secondary">{t.kanbanDetail.repo}</span>
          <span className={`min-w-0 flex-1 truncate ${primaryCodebase ? "text-primary" : "text-xs text-secondary"}`}>{repoSummary}</span>
          {worktree ? (
            <Badge tone={worktree.status === "active" ? "success" : worktree.status === "creating" ? "attention" : "danger"} className="font-mono">
              {effectiveBranch ?? worktree.branch}
            </Badge>
          ) : null}
          <span className="ml-auto text-xs text-secondary group-hover:text-primary">{t.kanbanDetail.editRepos}</span>
        </summary>
        <div className="space-y-3 border-t border-default px-3 py-3">
          {sessionInfo ? (
            <div className={`rounded-md border-l-2 px-3 py-2 ${sessionCwdMismatch ? "border-attention bg-attention-subtle" : "border-success bg-success-subtle"}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold text-primary">{t.kanbanDetail.repoHealth}</div>
                  <div className={`mt-1 text-xs ${sessionCwdMismatch ? "text-attention" : "text-success"}`}>
                    {sessionCwdMismatch ? t.kanbanDetail.sessionMismatch : t.kanbanDetail.sessionAligned}
                  </div>
                </div>
                <Badge tone={sessionCwdMismatch ? "attention" : "success"}>
                  {sessionCwdMismatch ? t.kanbanDetail.sessionMismatchLabel : t.kanbanDetail.alignedLabel}
                </Badge>
              </div>
              <div className="mt-2 space-y-1 text-[11px] text-secondary">
                {expectedPath ? (
                  <div>{t.kanbanDetail.expectedPath}: <span className="font-mono text-primary">{expectedPath}</span></div>
                ) : null}
                <div>{t.kanbanDetail.activeSessionPath}: <span className="font-mono text-primary">{sessionInfo.cwd}</span></div>
                {effectiveBranch ? (
                  <div>
                    {t.kanbanDetail.activeBranch}: <span className="font-mono text-primary">{effectiveBranch}</span>
                    {worktree?.branch && sessionInfo.branch && worktree.branch !== sessionInfo.branch ? (
                      <span className="ml-2 text-attention">{t.kanbanDetail.worktreeStored}: {worktree.branch}</span>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {sessionCwdMismatch ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {sessionIdToOpen && onSelectSession ? (
                    <Button variant="secondary" size="xs" onClick={() => onSelectSession(sessionIdToOpen)}>
                      {t.kanbanDetail.openActiveSession}
                    </Button>
                  ) : null}
                  {canAdoptSessionRepo && sessionRepoCodebase ? (
                    <Button
                      variant="secondary"
                      size="xs"
                      onClick={() => void patchCodebases(
                        [sessionRepoCodebase.id, ...currentCodebaseIds.filter((id) => id !== sessionRepoCodebase.id)],
                        t.kanbanDetail.failedToSwitchRepo,
                      )}
                    >
                      {t.kanbanDetail.useSessionRepo}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {codebases.length > 0 ? (
            <div>
              <div className="mb-2 text-[11px] text-secondary">{t.kanbanDetail.editLinkedRepos}</div>
              <div className="flex flex-wrap gap-1.5">
                {codebases.map((codebase) => {
                  const selected = currentCodebaseIds.includes(codebase.id);
                  return (
                    <button
                      key={codebase.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => void patchCodebases(
                        selected
                          ? currentCodebaseIds.filter((id) => id !== codebase.id)
                          : [...currentCodebaseIds, codebase.id],
                        t.kanbanDetail.failedToUpdateRepos,
                      )}
                      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] transition-colors focus-visible:outline-2 focus-visible:outline-accent ${
                        selected ? "border-accent bg-accent-subtle text-primary" : "border-default text-secondary hover:bg-hover"
                      }`}
                      data-testid="detail-repo-toggle"
                    >
                      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${codebase.sourceType === "github" ? "bg-information" : "bg-success"}`} />
                      {codebase.label ?? codebase.repoPath.split("/").pop() ?? codebase.repoPath}
                    </button>
                  );
                })}
              </div>
              {updateError ? <div role="alert" className="mt-1 text-xs text-danger">{updateError}</div> : null}
            </div>
          ) : null}
          {worktree ? (
            <div data-testid="worktree-detail" className="truncate font-mono text-xs text-secondary" title={worktree.worktreePath}>
              {worktree.worktreePath}
              {worktree.errorMessage ? <div className="mt-0.5 text-danger">{worktree.errorMessage}</div> : null}
            </div>
          ) : null}
        </div>
      </details>
    </DetailSection>
  );
}
