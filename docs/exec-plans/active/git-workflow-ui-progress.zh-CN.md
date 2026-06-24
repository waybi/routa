---
SOURCE START 内容已替换为译文 —— 仅输出翻译后的文件内容：

# Git 工作流 UI 实现进度

**Issue**: #396  
**Started**: 2026-04-08  
**Target**: 6 周（6 个阶段）

## 总体状态

- [x] 阶段 1：数据模型 + 后端 API（第 1 周）✅ **已完成**
- [x] 阶段 2：核心 UI（Unstaged/Staged 区块）（第 2 周）✅ **已完成**
- [ ] 阶段 3：Commits 区块 + Diff 查看器（第 3 周）🔜 **下一步**
- [ ] 阶段 4：Git 操作 + 快捷键（第 4 周）
- [ ] 阶段 5：打磨 + 测试（第 5 周）
- [ ] 阶段 6：文档 + 发布（第 6 周）

---

## 阶段 1：数据模型 + 后端 API ✅

### 已完成（2026-04-08）

**Commits**:
- `631b2cac` - feat(kanban): extend file changes types for git workflow UI (Phase 1)
- `5e55b9f2` - feat(kanban): add git workflow API endpoints (Phase 1 backend)
- `e1ecca69` - feat(kanban): add Rust backend for git workflow operations (Phase 1)

**TypeScript 类型** (`src/app/workspace/[workspaceId]/kanban/kanban-file-changes-types.ts`):
- [x] 扩展 `KanbanFileChangeItem`，新增：
  - `source?: 'agent' | 'manual' | 'git' | 'worktree'`
  - `timestamp?: number`
  - `staged?: boolean`
  - `selected?: boolean`
- [x] 扩展 `KanbanRepoChanges`，新增：
  - `unstagedFiles?: KanbanFileChangeItem[]`
  - `stagedFiles?: KanbanFileChangeItem[]`
  - `commits?: KanbanCommitInfo[]`
  - `targetBranch?: string`
  - `ahead?: number`, `behind?: number`
- [x] 新增 `KanbanCommitInfo` 接口（继承自 `KanbanCommitChangeItem`）
- [x] 新增 Git 操作的请求/响应类型：
  - `StageFilesRequest`, `UnstageFilesRequest`, `DiscardChangesRequest`
  - `CreateCommitRequest`, `PullCommitsRequest`
  - `RebaseRequest`, `ResetBranchRequest`
  - `GitOperationResponse`

**Node.js 后端** (`src/core/git/git-operations.ts`):
- [x] `stageFiles(repoPath, files)` - 暂存文件
- [x] `unstageFiles(repoPath, files)` - 取消暂存文件
- [x] `discardChanges(repoPath, files)` - 丢弃更改（破坏性操作）
- [x] `createCommit(repoPath, message, files?)` - 创建提交，返回 SHA
- [x] `pullCommits(repoPath, remote?, branch?)` - 从远端拉取
- [x] `rebaseBranch(repoPath, onto)` - 变基到目标分支
- [x] `resetBranch(repoPath, to, mode)` - 重置分支（soft/hard）
- [x] `getCommitList(repoPath, options)` - 获取提交历史
- [x] `CommitInfo` 接口

**Node.js API 路由** (`src/app/api/workspaces/[workspaceId]/codebases/[codebaseId]/git/`):
- [x] `POST /stage` - 暂存文件
- [x] `POST /unstage` - 取消暂存文件
- [x] `POST /commit` - 创建提交
- [x] `GET /commits` - 获取提交列表（支持 limit、since 查询参数）

**Rust 后端** (`crates/routa-core/src/git.rs`):
- [x] `stage_files(repo_path, files)` - 暂存文件
- [x] `unstage_files(repo_path, files)` - 取消暂存文件  
- [x] `discard_changes(repo_path, files)` - 丢弃更改
- [x] `create_commit(repo_path, message, files?)` - 创建提交，返回 SHA
- [x] `pull_commits(repo_path, remote?, branch?)` - 从远端拉取
- [x] `rebase_branch(repo_path, onto)` - 变基到目标分支
- [x] `reset_branch(repo_path, to, mode)` - 重置分支
- [x] `get_commit_list(repo_path, limit?, since?)` - 获取提交历史
- [x] `CommitInfo` 结构体

**Rust API** (`crates/routa-server/src/api/git.rs`):
- [x] 与 Node.js API 相同的 4 个端点
- [x] 已在 `codebases.rs` 路由中注册

---

## 阶段 2：核心 UI（Unstaged/Staged 区块）🔄

### 目标

**UI 组件** (`src/app/workspace/[workspaceId]/kanban/`):
- [ ] 创建 `KanbanFileChangesSectionHeader.tsx`
  - 区块标题（UNSTAGED / STAGED）
  - 文件数量徽标
  - 操作项（全选、折叠/展开）
- [ ] 创建 `KanbanFileChangeFileRow.tsx`
  - 用于选择的复选框
  - 基于状态的文件图标
  - 带语法高亮的文件路径
  - 状态徽标（M、A、D、R 等）
  - +/- 统计
  - 用于 diff 预览的 onClick 处理函数
  - 悬停操作
- [ ] 创建 `KanbanUnstagedSection.tsx`
  - 渲染未暂存文件列表
  - 自动提交开关
  - 批量操作（暂存选中项、丢弃选中项）
- [ ] 创建 `KanbanStagedSection.tsx`
  - 渲染已暂存文件列表
  - [Commit] 按钮
  - [Export] 按钮
  - 批量操作（取消暂存选中项）
- [ ] 更新 `KanbanFileChangesPanel.tsx`
  - 为 selectedFiles、activeDiffFile 添加状态
  - 添加 stage/unstage/select 的处理函数
  - 集成 UnstagedSection 和 StagedSection
  - 调用新的 API 端点

**数据获取**:
- [ ] 更新后端以分别返回 `unstagedFiles` 和 `stagedFiles`
- [ ] 实现客户端的 stage/unstage API hooks

### 备注

- 保持 FileRow 可点击以显示内联 diff（阶段 3）
- 复选框用于支持批量操作
- 遵循 `kanban-file-changes-panel.tsx` 中现有的模式

---

## 剩余阶段（预览）

### 阶段 3：Commits 区块 + Diff 查看器
- 带可展开文件列表的提交列表
- 内联 diff 查看器组件
- diff 缓存

### 阶段 4：Git 操作 + 快捷键
- 实现所有 Git 操作按钮
- 键盘快捷键（Cmd+K、Space、Enter 等）
- 错误处理与重试逻辑

### 阶段 5：打磨 + 测试
- 加载状态
- 乐观更新
- E2E 测试
- 错误提示（toast）

### 阶段 6：文档 + 发布
- 更新用户文档
- API 文档
- 迁移指南
- 发布说明

---

## 参考

- Issue: #396
- 设计文档: `docs/issues/2026-04-08-enhanced-git-workflow-ui-for-kanban-file-changes.md`
- 意图分析: `docs/references/intent-0.2.11-file-changes-analysis.md`
