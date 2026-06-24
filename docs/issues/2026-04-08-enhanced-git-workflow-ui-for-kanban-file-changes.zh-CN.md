---
title: "增强 Kanban 文件变更面板的 Git 工作流 UI"
date: "2026-04-08"
status: resolved
severity: medium
area: "ui"
tags: ["kanban", "git", "ui", "workflow", "github-sync"]
reported_by: "agent"
related_issues:
  - "https://github.com/phodal/routa/issues/396"
  - "2026-04-08-git-workflow-ui-summary.md"
github_issue: 396
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/396"
resolved_at: "2026-04-08"
---

# 增强 Kanban 文件变更面板的 Git 工作流 UI

**日期**: 2026-04-08  
**状态**: Open  
**优先级**: High  
**Epic**: 看板 - 文件变更管理  
**灵感来源**: Intent 0.2.11 (Augment Code)、Cursor IDE

## 问题陈述

当前的 `KanbanFileChangesPanel` 仅显示基本的文件变更信息，缺少可交互的 Git 工作流能力。用户无法：

1. 暂存/取消暂存单个文件或文件分组
2. 查看带可展开文件列表的提交历史
3. 执行 Git 操作（commit、reset、rebase、pull）
4. 在不同上下文中审阅变更（未暂存 vs 已暂存 vs 提交）
5. 与文件交互以内联查看 diff

这限制了看板作为完整工作区管理工具的有效性。

## 当前状态

**文件**: `src/app/workspace/[workspaceId]/kanban/kanban-file-changes-panel.tsx`

**当前功能**:
- ✅ 按仓库分组显示变更文件
- ✅ 显示文件状态徽标（M、A、D、R 等）
- ✅ 显示新增/删除行数
- ✅ 可折叠的仓库分区
- ✅ 分支与同步状态

**缺失功能**:
- ❌ 没有暂存/取消暂存操作
- ❌ 没有提交列表视图
- ❌ 没有 Git 操作（commit、reset、pull、rebase）
- ❌ 点击文件时没有内联 diff 预览
- ❌ 没有批量操作
- ❌ 没有键盘快捷键

## 建议方案

### UI 重新设计 —— 三段式布局

基于所提供的截图与 Intent 的架构：

```
┌─────────────────────────────────────────────────────────────┐
│ Header: "12 files changed in Space"                        │
│ Branch: integrate-auggie-acp-agent → master                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ ● UNSTAGED / NEW                        [Auto-commit: ON]  │
│   ┌─────────────────────────────────────────────────────┐ │
│   │ □ file1.ts                           +10 -5         │ │
│   │ □ file2.tsx                          +23 -8         │ │
│   └─────────────────────────────────────────────────────┘ │
│                                                             │
│ ● STAGED / APPROVED                                         │
│   ┌─────────────────────────────────────────────────────┐ │
│   │ □ config.ts                          +5 -2          │ │
│   └─────────────────────────────────────────────────────┘ │
│                                                             │
│   [Commit ↓]  [Export →]                                   │
│                                                             │
│ ● COMMITS                                                   │
│   ┌─────────────────────────────────────────────────────┐ │
│   │ ⚙️ Run Tests and Verify Build              [↗] [↻] │ │
│   │   └─ 📄 build.gradle.kts                            │ │
│   │   └─ 📄 Utf8ParsingTest.kt                          │ │
│   │                                                      │ │
│   │ ⚙️ fix: Change issue reference #538 → #536          │ │
│   │                                                      │ │
│   │ ⚙️ feat: Add Auggie ACP agent integration           │ │
│   └─────────────────────────────────────────────────────┘ │
│                                                             │
│   [Pull 24 Commits ↑]  [Rebase onto master ↻]             │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ 🔄 Reset and continue working                              │
│    Reset branch to master and keep working                 │
│                                                             │
│ 🚀 Archive and start new space                             │
│    Continue working on this repo in a fresh workspace      │
└─────────────────────────────────────────────────────────────┘
```

### 需要实现的核心功能

#### 1. **三状态文件管理**

**UNSTAGED / NEW（未暂存 / 新增）**
- 显示所有工作目录变更
- 通过复选框选择以进行批量操作
- 点击文件 → 显示内联 diff 预览
- 右键 → 上下文菜单（暂存、丢弃、在编辑器中打开）
- 自动提交开关

**STAGED / APPROVED（已暂存 / 已批准）**
- 显示已暂存、准备提交的文件
- 复选框选择
- 点击文件 → 显示 diff 预览
- 右键 → 取消暂存选项

**COMMITS（提交）**
- 显示提交历史（来自当前分支）
- 可展开以显示每个提交中的文件
- 每个提交显示：
  - 提交图标（⚙️）
  - 简短消息
  - 操作：[Open ↗] [Revert ↻]
- 点击提交 → 展开以显示变更文件
- 点击提交中的文件 → 显示该文件在该提交中的 diff

#### 2. **Git 操作**

**主要操作**:
- `Commit ↓` —— 从已暂存文件创建提交
- `Export →` —— 导出变更/补丁
- `Pull X Commits ↑` —— 从远程拉取
- `Rebase onto {branch} ↻` —— 变基当前分支

**工作流操作**:
- `Reset and continue working` —— 重置到目标分支，保留工作目录
- `Archive and start new space` —— 从全新检出创建新工作区

#### 3. **可交互的文件操作**

**单文件操作**:
- 暂存/取消暂存（拖放或按钮）
- 丢弃变更
- 在编辑器中打开
- 复制路径

**批量操作**:
- 通过复选框选择多个文件
- 暂存所有选中项
- 取消暂存所有选中项
- 丢弃所有选中项

#### 4. **内联 Diff 预览**

在 UNSTAGED/STAGED 中点击文件时：
- 在展开面板中显示 diff 查看器
- 语法高亮
- 行号
- +/- 指示符
- 能够暂存/取消暂存单个 hunk

#### 5. **键盘快捷键**

- `Cmd/Ctrl + K` —— 切换文件变更面板
- `Space` —— 暂存/取消暂存选中的文件
- `Enter` —— 显示选中文件的 diff
- `↑/↓` —— 在文件间导航
- `Cmd/Ctrl + A` —— 选中当前分区中的所有文件
- `Esc` —— 关闭面板或折叠 diff

## 技术实现

### 阶段 1：数据模型扩展

**扩展现有类型**:

```typescript
// kanban-file-changes-types.ts
export interface KanbanFileChangeItem {
  path: string;
  status: KanbanFileChangeStatus;
  previousPath?: string;
  additions?: number;
  deletions?: number;
  source?: 'agent' | 'manual' | 'git' | 'worktree';  // NEW
  timestamp?: number;  // NEW
  staged?: boolean;  // NEW
  selected?: boolean;  // NEW - for UI state
}

export interface KanbanCommitInfo {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  authoredAt: string;
  additions: number;
  deletions: number;
  files?: KanbanFileChangeItem[];  // NEW - files in this commit
  expanded?: boolean;  // NEW - UI state
}

export interface KanbanRepoChanges {
  // existing fields...
  unstagedFiles: KanbanFileChangeItem[];  // NEW - split from files
  stagedFiles: KanbanFileChangeItem[];    // NEW
  commits: KanbanCommitInfo[];             // NEW
  currentBranch: string;                   // NEW
  targetBranch?: string;                   // NEW - for PR/merge context
  ahead: number;                           // NEW - commits ahead of remote
  behind: number;                          // NEW - commits behind remote
}
```

### 阶段 2：后端 API 扩展

**需要的新端点**:

```typescript
// File operations
POST /api/workspaces/:workspaceId/repos/:codebaseId/stage
  body: { files: string[] }

POST /api/workspaces/:workspaceId/repos/:codebaseId/unstage
  body: { files: string[] }

POST /api/workspaces/:workspaceId/repos/:codebaseId/discard
  body: { files: string[] }

// Commit operations
GET  /api/workspaces/:workspaceId/repos/:codebaseId/commits
  query: { limit?: number, since?: string }

POST /api/workspaces/:workspaceId/repos/:codebaseId/commit
  body: { message: string, files?: string[] }

GET  /api/workspaces/:workspaceId/repos/:codebaseId/commits/:sha/files

// Git workflow operations
POST /api/workspaces/:workspaceId/repos/:codebaseId/pull
POST /api/workspaces/:workspaceId/repos/:codebaseId/rebase
  body: { onto: string }

POST /api/workspaces/:workspaceId/repos/:codebaseId/reset
  body: { to: string, mode: 'soft' | 'hard' }

// Diff preview
GET  /api/workspaces/:workspaceId/repos/:codebaseId/diff
  query: { path: string, staged?: boolean }

GET  /api/workspaces/:workspaceId/repos/:codebaseId/commits/:sha/diff
  query: { path: string }
```

### 阶段 3：UI 组件架构

**组件拆分**:

```
KanbanFileChangesPanel (main container)
├─ FileChangesHeader
│  ├─ BranchIndicator
│  └─ SummaryStats
├─ UnstagedSection
│  ├─ SectionHeader (with Auto-commit toggle)
│  ├─ FileList
│  │  └─ FileRow[] (with checkbox + onClick)
│  └─ InlineDiffViewer (conditional)
├─ StagedSection
│  ├─ SectionHeader
│  ├─ FileList
│  │  └─ FileRow[]
│  └─ ActionButtons (Commit, Export)
├─ CommitsSection
│  ├─ SectionHeader
│  ├─ CommitList
│  │  └─ CommitItem[] (expandable)
│  │     └─ FileList (files in commit)
│  └─ GitOperationButtons (Pull, Rebase)
└─ WorkflowActions
   ├─ ResetAction
   └─ ArchiveAction
```

### 阶段 4：状态管理

**添加到 KanbanFileChangesPanel**:

```typescript
const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
const [expandedCommits, setExpandedCommits] = useState<Set<string>>(new Set());
const [activeDiffFile, setActiveDiffFile] = useState<{
  path: string;
  staged: boolean;
  commitSha?: string;
} | null>(null);
const [diffCache, setDiffCache] = useState<Record<string, string>>({});
const [loadingDiff, setLoadingDiff] = useState(false);
const [autoCommit, setAutoCommit] = useState(false);
```

### 阶段 5：集成点

**Rust 后端集成**:
- 使用现有的 `git2` crate 进行 Git 操作
- 通过 `git2::Index` 实现暂存/取消暂存
- 通过 `git2::Repository::commit` 实现提交创建
- 通过 `git2::Revwalk` 解析提交历史
- 通过 `git2::Diff` 生成 diff

**文件监听**:
- 扩展现有文件监听器以检测暂存区变更
- 当 `.git/index` 变更时使缓存失效
- 检测到新提交时自动刷新提交列表

## UI/UX 考量

### 视觉设计原则

1. **清晰的状态指示**
   - 为未暂存（琥珀色）、已暂存（绿色）和提交（蓝色）使用不同颜色
   - 图标系统：⚙️ 表示提交，复选框表示文件
   - 状态徽标（M、A、D、R）

2. **渐进式披露**
   - 提交默认折叠
   - diff 查看器按需显示
   - 长列表使用「显示所有文件」

3. **反馈与加载状态**
   - 暂存/取消暂存采用乐观更新
   - diff 获取时显示加载动画
   - Git 操作的成功/错误提示（toast）

4. **可访问性**
   - 全程支持键盘导航
   - 所有可交互元素带 ARIA 标签
   - 打开/关闭分区时进行焦点管理

### 错误处理

- 为失败的 Git 操作显示内联错误
- 网络操作的重试机制
- 当 Git 仓库处于不良状态时优雅降级
- 清晰的错误消息并附带建议操作

## 测试策略

### 单元测试

- 文件暂存/取消暂存逻辑
- 提交列表解析
- diff 缓存
- 选择状态管理

### 集成测试

- 暂存文件 → 提交 → 在提交列表中验证
- 展开提交 → 点击文件 → 查看 diff
- 批量操作（选择多个 → 全部暂存）
- 键盘快捷键

### E2E 测试

- 完整工作流：未暂存 → 已暂存 → 提交 → 查看历史
- 重置工作流
- pull 与 rebase 操作
- 跨仓库操作（多代码库任务）

## 成功指标

- ✅ 用户无需离开看板即可暂存/取消暂存文件
- ✅ 用户可以内联查看提交历史和文件 diff
- ✅ 用户可以执行基本 Git 操作（commit、pull、reset）
- ✅ 切换到外部 Git 工具的上下文切换减少 80%+
- ✅ 所有操作均可通过键盘快捷键访问

## 参考

### 灵感来源

1. **Intent 0.2.11** (Augment Code)
   - 分析：`docs/references/intent-0.2.11-file-changes-analysis.md`
   - 关键特性：多视图变更管理、导航历史、agent 集成

2. **Cursor IDE**（已提供截图）
   - 三段式布局（Unstaged/Staged/Commits）
   - 带文件列表的可展开提交
   - 清晰的 Git 操作按钮
   - 整洁的视觉层级

3. **VS Code Source Control**
   - 内联 diff 查看器
   - 暂存/取消暂存 hunk
   - 带校验的提交输入

### 相关 Issue

- 初始文件追踪：（指向原始文件变更实现的链接）
- 看板文件变更面板：（当前实现）

### 实现时间线

**第 1 周**: 数据模型 + 后端 API
**第 2 周**: 核心 UI 组件（Unstaged/Staged 分区）
**第 3 周**: Commits 分区 + Diff 查看器
**第 4 周**: Git 操作 + 键盘快捷键
**第 5 周**: 打磨 + 测试
**第 6 周**: 文档 + 发布

## 待解决问题

1. 我们是否应支持交互式 rebase UI？
2. 如何在面板中处理合并冲突？
3. 「自动提交」是否应在文件变更时自动创建提交？
4. 是否支持 stash 操作？
5. cherry-pick UI？

---

**后续步骤**:
1. 审阅本 issue 以就范围达成一致
2. 为每个阶段创建子任务
3. 设计详细的视觉稿
4. 实现阶段 1（数据模型）
