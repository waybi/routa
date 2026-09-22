"use client";

/**
 * State and handlers for the workspace "repositories" modal on the Kanban
 * board: selecting a codebase, editing / re-cloning / removing it, adding a
 * new one, and cleaning up its issue branches and worktrees.
 *
 * Extracted from `kanban-tab.tsx` following the repo playbook
 * (`docs/REFACTOR.md`: orchestration shell + domain hooks). Everything here
 * touches only the modal; the board reads two things back — `open` for the
 * Escape handler and `openCodebaseModal` for the status bar.
 */

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { CodebaseData } from "@/client/hooks/use-workspaces";
import type { RepoSelection } from "@/client/components/repo-picker";
import { useConfirm } from "@/client/components/confirm-dialog";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { useTranslation } from "@/i18n";
import type { TaskInfo, WorktreeInfo } from "../types";

export interface LiveBranchInfo {
  current: string;
  branches: string[];
}

export interface UseKanbanCodebaseModalOptions {
  workspaceId: string;
  codebases: CodebaseData[];
  defaultCodebase: CodebaseData | null | undefined;
  localTasks: TaskInfo[];
  setLocalTasks: Dispatch<SetStateAction<TaskInfo[]>>;
  setWorktreeCache: Dispatch<SetStateAction<Record<string, WorktreeInfo>>>;
  patchTask: (taskId: string, payload: Record<string, unknown>) => Promise<TaskInfo>;
  onRefresh: () => void;
}

export function useKanbanCodebaseModal({
  workspaceId,
  codebases,
  defaultCodebase,
  localTasks,
  setLocalTasks,
  setWorktreeCache,
  patchTask,
  onRefresh,
}: UseKanbanCodebaseModalOptions) {
  const { t } = useTranslation();
  const confirm = useConfirm();

  const [open, setOpen] = useState(false);
  const [selectedCodebase, setSelectedCodebase] = useState<CodebaseData | null>(null);
  const [codebaseWorktrees, setCodebaseWorktrees] = useState<WorktreeInfo[]>([]);
  const [addRepoSelection, setAddRepoSelection] = useState<RepoSelection | null>(null);
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  // Edit state - uses RepoPicker for re-selecting / cloning
  const [editingCodebase, setEditingCodebase] = useState(false);
  const [editRepoSelection, setEditRepoSelection] = useState<RepoSelection | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  // Re-clone state
  const [recloning, setRecloning] = useState(false);
  const [recloneError, setRecloneError] = useState<string | null>(null);
  const [recloneSuccess, setRecloneSuccess] = useState<string | null>(null);
  // Replace-all-repos state
  const [showReplaceAllConfirm, setShowReplaceAllConfirm] = useState(false);
  const [replacingAll, setReplacingAll] = useState(false);
  // Delete codebase state
  const [showDeleteCodebaseConfirm, setShowDeleteCodebaseConfirm] = useState(false);
  const [deletingCodebase, setDeletingCodebase] = useState(false);
  const [deletingWorktreeIds, setDeletingWorktreeIds] = useState<string[]>([]);
  const [deletingBranchNames, setDeletingBranchNames] = useState<string[]>([]);
  const [branchActionError, setBranchActionError] = useState<string | null>(null);
  const [worktreeActionError, setWorktreeActionError] = useState<string | null>(null);
  // Live branch info for the selected codebase
  const [liveBranchInfo, setLiveBranchInfo] = useState<LiveBranchInfo | null>(null);

  const handleStartEditCodebase = useCallback(() => {
    if (!selectedCodebase) return;
    setEditRepoSelection({
      path: selectedCodebase.repoPath,
      branch: selectedCodebase.branch ?? "",
      name: selectedCodebase.label ?? selectedCodebase.repoPath.split("/").pop() ?? "",
    });
    setEditError(null);
    setEditingCodebase(true);
  }, [selectedCodebase]);

  const handleRepoSelectionChange = useCallback(async (selection: RepoSelection | null) => {
    if (!selection || !selectedCodebase) return;
    setEditRepoSelection(selection);
    setEditSaving(true);
    setEditError(null);
    try {
      const res = await desktopAwareFetch(`/api/codebases/${encodeURIComponent(selectedCodebase.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: selection.name, repoPath: selection.path, branch: selection.branch }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update repository");
      setEditingCodebase(false);
      setSelectedCodebase(null);
      setCodebaseWorktrees([]);
      onRefresh();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to update repository");
    } finally {
      setEditSaving(false);
    }
  }, [selectedCodebase, onRefresh]);

  const handleCancelEditCodebase = useCallback(() => {
    setEditingCodebase(false);
    setEditRepoSelection(null);
    setEditError(null);
  }, []);

  const handleReclone = useCallback(async () => {
    if (!selectedCodebase?.sourceUrl) return;
    setRecloning(true);
    setRecloneError(null);
    setRecloneSuccess(null);
    try {
      const res = await desktopAwareFetch("/api/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: selectedCodebase.sourceUrl, force: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to re-clone repository");

      if (data.path && data.path !== selectedCodebase.repoPath) {
        await desktopAwareFetch(`/api/codebases/${encodeURIComponent(selectedCodebase.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repoPath: data.path, branch: data.branch }),
        });
      }
      setRecloneSuccess(`Repository re-cloned successfully${data.existed ? " (pulled latest)" : ""}`);
      onRefresh();
    } catch (err) {
      setRecloneError(err instanceof Error ? err.message : "Failed to re-clone repository");
    } finally {
      setRecloning(false);
    }
  }, [selectedCodebase, onRefresh]);

  const handleReplaceAllRepos = useCallback(async () => {
    if (!selectedCodebase?.sourceUrl || !editRepoSelection) return;
    setReplacingAll(true);
    setRecloneError(null);
    try {
      await Promise.all(codebases.map(async (cb) => {
        const res = await desktopAwareFetch(`/api/codebases/${encodeURIComponent(cb.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repoPath: editRepoSelection.path,
            branch: editRepoSelection.branch,
            label: editRepoSelection.name,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error ?? `Failed to update codebase ${cb.id}`);
        }
      }));
      setShowReplaceAllConfirm(false);
      setEditingCodebase(false);
      setSelectedCodebase(null);
      setCodebaseWorktrees([]);
      onRefresh();
    } catch (err) {
      setRecloneError(err instanceof Error ? err.message : "Failed to replace repositories");
    } finally {
      setReplacingAll(false);
    }
  }, [selectedCodebase, editRepoSelection, codebases, onRefresh]);

  const handleRemoveCodebase = useCallback(async () => {
    if (!selectedCodebase) return;
    setDeletingCodebase(true);
    setEditError(null);
    try {
      const res = await desktopAwareFetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/codebases/${encodeURIComponent(selectedCodebase.id)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to remove repository");
      }
      setShowDeleteCodebaseConfirm(false);
      setSelectedCodebase(null);
      setCodebaseWorktrees([]);
      onRefresh();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to remove repository");
    } finally {
      setDeletingCodebase(false);
    }
  }, [selectedCodebase, workspaceId, onRefresh]);

  const fetchCodebaseWorktrees = useCallback(async (codebase: CodebaseData) => {
    setLiveBranchInfo(null);
    setBranchActionError(null);

    try {
      const res = await desktopAwareFetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/codebases/${encodeURIComponent(codebase.id)}/worktrees`,
        { cache: "no-store" },
      );
      if (res.ok) {
        const data = await res.json();
        setCodebaseWorktrees(Array.isArray(data.worktrees) ? data.worktrees as WorktreeInfo[] : []);
      }
    } catch { /* ignore */ }

    try {
      const branchRes = await desktopAwareFetch(
        `/api/clone/branches?repoPath=${encodeURIComponent(codebase.repoPath)}`,
        { cache: "no-store" },
      );
      if (branchRes.ok) {
        const branchData = await branchRes.json();
        setLiveBranchInfo({ current: branchData.current, branches: branchData.local || [] });
      }
    } catch { /* ignore */ }
  }, [workspaceId]);

  const selectCodebase = useCallback(async (codebase: CodebaseData | null) => {
    setSelectedCodebase(codebase);
    setCodebaseWorktrees([]);
    setLiveBranchInfo(null);
    setBranchActionError(null);
    setWorktreeActionError(null);
    setDeletingBranchNames([]);
    setDeletingWorktreeIds([]);
    setEditingCodebase(false);
    setEditError(null);
    setEditRepoSelection(null);
    setRecloneError(null);
    setRecloneSuccess(null);
    setShowDeleteCodebaseConfirm(false);

    if (codebase) {
      await fetchCodebaseWorktrees(codebase);
    }
  }, [fetchCodebaseWorktrees]);

  const closeCodebaseModal = useCallback(() => {
    setOpen(false);
    setSelectedCodebase(null);
    setCodebaseWorktrees([]);
    setEditingCodebase(false);
    setLiveBranchInfo(null);
    setBranchActionError(null);
    setDeletingBranchNames([]);
    setRecloneError(null);
    setRecloneSuccess(null);
    setAddRepoSelection(null);
    setAddError(null);
    setShowDeleteCodebaseConfirm(false);
  }, []);

  const openCodebaseModal = useCallback(() => {
    setOpen(true);
    const nextCodebase = selectedCodebase ?? defaultCodebase ?? codebases[0] ?? null;
    if (nextCodebase) {
      void selectCodebase(nextCodebase);
    }
  }, [codebases, defaultCodebase, selectedCodebase, selectCodebase]);

  const handleAddCodebase = useCallback(async (selection: RepoSelection | null) => {
    if (!selection) return;
    setAddRepoSelection(selection);
    setAddSaving(true);
    setAddError(null);
    try {
      const res = await desktopAwareFetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/codebases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoPath: selection.path, branch: selection.branch, label: selection.name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add repository");
      onRefresh();
      const nextCodebase = data.codebase as CodebaseData | undefined;
      if (nextCodebase) {
        await selectCodebase(nextCodebase);
      }
      setAddRepoSelection(null);
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "Failed to add repository");
    } finally {
      setAddSaving(false);
    }
  }, [onRefresh, selectCodebase, workspaceId]);

  // Keep the selection valid when the codebase list changes underneath an
  // open modal (e.g. the selected repo was removed elsewhere).
  useEffect(() => {
    if (!open) return;
    if (selectedCodebase && codebases.some((codebase) => codebase.id === selectedCodebase.id)) return;
    const nextCodebase = defaultCodebase ?? codebases[0] ?? null;
    if (nextCodebase) {
      void selectCodebase(nextCodebase);
    } else {
      setSelectedCodebase(null);
      setCodebaseWorktrees([]);
      setLiveBranchInfo(null);
    }
  }, [codebases, defaultCodebase, open, selectedCodebase, selectCodebase]);

  const deleteIssueBranches = useCallback(async (branches: string[]) => {
    if (!selectedCodebase || branches.length === 0) return;

    const uniqueBranches = [...new Set(branches)];
    setBranchActionError(null);
    setDeletingBranchNames((current) => [...new Set([...current, ...uniqueBranches])]);

    let latestBranchInfo: LiveBranchInfo | null = null;
    const failures: string[] = [];
    try {
      for (const branch of uniqueBranches) {
        const response = await desktopAwareFetch("/api/clone/branches", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repoPath: selectedCodebase.repoPath, branch }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !(data as { success?: boolean }).success) {
          failures.push((data as { error?: string }).error ?? `Failed to delete branch '${branch}'`);
          continue;
        }

        const nextCurrentBranch: string =
          latestBranchInfo?.current ?? liveBranchInfo?.current ?? selectedCodebase.branch ?? "";
        const nextBranches: string[] = latestBranchInfo?.branches ?? liveBranchInfo?.branches ?? [];
        latestBranchInfo = {
          current: typeof (data as { current?: string }).current === "string"
            ? (data as { current: string }).current
            : nextCurrentBranch,
          branches: Array.isArray((data as { branches?: unknown[] }).branches)
            ? (data as { branches: string[] }).branches
            : nextBranches,
        };
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : "Failed to delete branches");
    } finally {
      setDeletingBranchNames((current) => current.filter((name) => !uniqueBranches.includes(name)));
    }

    if (latestBranchInfo) {
      setLiveBranchInfo(latestBranchInfo);
    }
    if (failures.length > 0) {
      setBranchActionError(
        t.kanbanModals.removeBranchesFailed
          .replace("{count}", String(failures.length))
          .replace("{branches}", failures.join("; ")),
      );
    }
  }, [liveBranchInfo, selectedCodebase, t.kanbanModals.removeBranchesFailed]);

  const handleDeleteIssueBranch = useCallback(async (branch: string) => {
    const confirmed = await confirm({
      message: t.kanbanModals.removeBranchConfirm.replace("{branch}", branch),
      destructive: true,
    });
    if (!confirmed) return;
    await deleteIssueBranches([branch]);
  }, [confirm, deleteIssueBranches, t.kanbanModals.removeBranchConfirm]);

  const handleDeleteIssueBranches = useCallback(async (branches: string[]) => {
    if (branches.length === 0) return;
    const confirmed = await confirm({
      message: t.kanbanModals.clearIssueBranchesConfirm.replace("{count}", String(branches.length)),
      destructive: true,
    });
    if (!confirmed) return;
    await deleteIssueBranches(branches);
  }, [confirm, deleteIssueBranches, t.kanbanModals.clearIssueBranchesConfirm]);

  const handleDeleteCodebaseWorktrees = useCallback(async (worktrees: WorktreeInfo[]) => {
    if (worktrees.length === 0) return;

    const ids = [...new Set(worktrees.map((worktree) => worktree.id))];
    const worktreeIdSet = new Set(ids);
    setWorktreeActionError(null);
    setDeletingWorktreeIds(ids);
    try {
      for (const worktree of worktrees) {
        const linkedTasks = localTasks.filter((task) => task.worktreeId === worktree.id);
        await Promise.all(linkedTasks.map((task) => patchTask(task.id, { worktreeId: null })));

        const response = await desktopAwareFetch(`/api/worktrees/${encodeURIComponent(worktree.id)}`, {
          method: "DELETE",
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error((data as { error?: string }).error ?? "Failed to delete worktree");
        }
      }

      setLocalTasks((current) => current.map((task) => (
        task.worktreeId && worktreeIdSet.has(task.worktreeId)
          ? { ...task, worktreeId: undefined }
          : task
      )));
      setCodebaseWorktrees((current) => current.filter((item) => !worktreeIdSet.has(item.id)));
      setWorktreeCache((current) => {
        const next = { ...current };
        for (const id of ids) delete next[id];
        return next;
      });
    } catch (error) {
      setWorktreeActionError(error instanceof Error ? error.message : "Failed to delete worktree");
    } finally {
      setDeletingWorktreeIds([]);
    }
  }, [localTasks, patchTask, setLocalTasks, setWorktreeCache]);

  return {
    // Board-facing surface
    open,
    openCodebaseModal,
    closeCodebaseModal,
    selectCodebase,
    // Main modal
    selectedCodebase,
    editingCodebase,
    addRepoSelection,
    setAddRepoSelection,
    addSaving,
    addError,
    handleAddCodebase,
    editRepoSelection,
    handleRepoSelectionChange,
    editError,
    recloneError,
    editSaving,
    replacingAll,
    setShowReplaceAllConfirm,
    handleCancelEditCodebase,
    codebaseWorktrees,
    worktreeActionError,
    handleDeleteCodebaseWorktrees,
    deletingWorktreeIds,
    liveBranchInfo,
    branchActionError,
    handleDeleteIssueBranch,
    handleDeleteIssueBranches,
    deletingBranchNames,
    handleReclone,
    recloning,
    recloneSuccess,
    handleStartEditCodebase,
    // Delete-codebase confirm
    showDeleteCodebaseConfirm,
    setShowDeleteCodebaseConfirm,
    deletingCodebase,
    handleRemoveCodebase,
    // Replace-all confirm
    showReplaceAllConfirm,
    handleReplaceAllRepos,
  };
}
