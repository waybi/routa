---
date: 2026-04-07
title: 看板工作流中的裸 Git 仓库处理
status: resolved
severity: medium
area: kanban
affected_component: Kanban - Auto-sync
github_issue: 386
github_state: closed
github_url: https://github.com/phodal/routa/issues/386
---

# 看板工作流中的裸 Git 仓库处理

## 问题

当看板页面加载时，它会自动将所有代码库同步到最新代码。当某个代码库指向裸 git 仓库时，此操作会失败并抛出令人困惑的错误：

> phodal/routa: Repository path points to a bare git repo. Switch branches in a worktree instead.

**影响：**
- 每次看板页面加载都会显示错误
- 用户不清楚该怎么办
- 工作流被中断

## 根因

1. **页面加载时自动同步**：`kanban-page-client.tsx` 会自动为所有代码库调用 `syncWorkspaceRepos()`
2. **裸仓库没有工作树**：以下操作会失败：
   - `git checkout <branch>` —— 没有可供检出的工作目录
   - `git pull --ff-only` —— 没有可供更新的工作目录
   - `git status` —— 没有可供检查的工作目录
3. **缺少校验**：系统允许将裸仓库添加为代码库，且没有任何警告

## 为什么用户会把裸仓库当作代码库

用户可能会意外地将裸仓库添加为代码库：
- 手动指向某个 `.git` 目录
- 指向镜像克隆（`git clone --mirror`）
- 指向用于工作树管理的裸仓库
- 指向在初始配置后被转换为裸仓库的仓库

## 解决方案

实施了 3 项互补的修复：

### 1. 跳过裸仓库的自动同步

**文件**：`src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx`

```typescript
const syncCodebaseToLatest = useCallback(async (codebase: CodebaseData): Promise<void> => {
  // Check if this is a bare repository
  const bareCheckRes = await desktopAwareFetch(...);
  const bareCheckData = await bareCheckRes.json().catch(() => ({}));
  
  // If the error mentions bare repo, skip sync
  if (!bareCheckRes.ok && bareCheckData.error?.includes("bare git repo")) {
    console.log(`[sync] Skipping bare repo: ${codebase.label}`);
    return; // Bare repos can't be synced
  }
  
  // ... rest of sync logic
}, []);
```

**结果**：即使工作区中存在裸仓库，看板页面也能正常加载而不报错。

### 2. 添加代码库时进行校验

**文件**：`src/app/api/workspaces/[workspaceId]/codebases/route.ts`

```typescript
// Check if this is a bare repository
if (isBareGitRepository(repoPath)) {
  return NextResponse.json(
    { 
      error: "Cannot add a bare git repository as a codebase",
      suggestion: "Bare repos don't have a working directory and can't be synced or checked out. Clone a regular working copy instead, or use this repo as a worktree source for task-specific branches."
    },
    { status: 400 }
  );
}
```

**结果**：用户无法再意外地将裸仓库添加为代码库。

### 3. 改进错误信息

更新了 5 个 API 端点，以提供更清晰、更具可操作性的错误信息：

**之前**：
```
"Repository path points to a bare git repo. Switch branches in a worktree instead."
```

**之后**：
```json
{
  "error": "This repository is a bare git repository (no working directory)",
  "suggestion": "Bare repos can't be checked out or synced. Use them as worktree sources instead, or clone a regular working copy."
}
```

**已更新的端点**：
- `/api/clone/branches`（PATCH - 检出）
- `/api/clone/branches`（DELETE - 删除分支）  
- `/api/clone`（PATCH - 切换分支）
- `/api/workspaces/[workspaceId]/codebases/changes`（GET）
- `/api/tasks/[taskId]/changes`（GET）

## 测试

- ✅ 所有单元测试通过
- ✅ 更新了测试断言以匹配新的错误格式
- ✅ 手动测试：在存在裸仓库的情况下看板正确加载
- ✅ 校验可防止添加新的裸仓库

## 变更文件

- `src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx` - 跳过自动同步
- `src/app/api/workspaces/[workspaceId]/codebases/route.ts` - 添加校验
- `src/app/api/clone/branches/route.ts` - 改进错误信息
- `src/app/api/clone/route.ts` - 改进错误信息
- `src/app/api/tasks/[taskId]/changes/route.ts` - 改进错误信息
- `src/app/api/workspaces/[workspaceId]/codebases/changes/route.ts` - 改进错误信息
- `src/app/api/clone/branches/__tests__/route.test.ts` - 更新测试
- `src/app/api/workspaces/[workspaceId]/codebases/changes/__tests__/route.test.ts` - 更新测试

## 相关工作

工作树机制本身运行正常。本问题的核心在于防止用户意外地将裸仓库用作常规代码库，因为裸仓库无法被同步或检出。

裸仓库作为**工作树源（worktree sources）**仍然是有效且有用的 —— 这正是预期的使用场景：任务从共享的裸仓库中创建工作树。
