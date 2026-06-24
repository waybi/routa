---
title: "看板文件变更的 Git 工作流 UI 增强总结"
date: "2026-04-08"
kind: progress_note
status: resolved
severity: low
area: "ui"
tags: ["kanban", "git", "ui", "summary", "github-sync"]
reported_by: "agent"
related_issues:
  - "https://github.com/phodal/routa/issues/396"
  - "2026-04-08-enhanced-git-workflow-ui-for-kanban-file-changes.md"
github_issue: 396
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/396"
resolved_at: "2026-04-08"
---

# Git 工作流 UI 增强 - 总结

**日期**: 2026-04-08  
**GitHub Issue**: #396  
**状态**: 已创建  

## 我们要构建什么

将看板文件变更面板从一个**只读文件列表**改造为一个完整的 **Git 工作流 UI**，灵感来自 Intent（Augment Code）和 Cursor IDE。

## 关键视觉对比

### 改造前（当前状态）
```
┌─────────────────────────────┐
│ File Changes                │
├─────────────────────────────┤
│ routa-js @ main             │
│   • file1.ts       +10 -5   │
│   • file2.tsx      +23 -8   │
│   • config.ts      +5  -2   │
│                             │
│ (no interactions)           │
└─────────────────────────────┘
```

### 改造后（目标状态 - 类似 Cursor/Intent）
```
┌─────────────────────────────────────────────┐
│ 12 files changed in Space                  │
│ feature-branch → main                       │
├─────────────────────────────────────────────┤
│ ● UNSTAGED / NEW          [Auto-commit: ON] │
│   □ file1.ts                     +10 -5     │
│   □ file2.tsx                    +23 -8     │
│                                             │
│ ● STAGED / APPROVED                         │
│   □ config.ts                    +5  -2     │
│   [Commit ↓]  [Export →]                    │
│                                             │
│ ● COMMITS                                   │
│   ⚙️ Run Tests and Verify Build     [↗][↻]  │
│     └─ 📄 build.gradle.kts                  │
│     └─ 📄 Utf8ParsingTest.kt                │
│   ⚙️ fix: Issue reference #538 → #536       │
│   ⚙️ feat: Add Auggie ACP integration       │
│                                             │
│   [Pull 24 Commits ↑] [Rebase onto main ↻] │
│                                             │
│ 🔄 Reset and continue working               │
│ 🚀 Archive and start new space              │
└─────────────────────────────────────────────┘
```

## 需要新增的核心功能

### 1. 三段式布局 ⭐⭐⭐
- **UNSTAGED / NEW**：工作目录中的变更
- **STAGED / APPROVED**：已准备好提交的文件
- **COMMITS**：可展开文件列表的提交历史

### 2. 交互式文件操作 ⭐⭐⭐
- ✅ 点击文件 → 显示内联 diff 预览
- ✅ 复选框选择以进行批量操作
- ✅ 暂存/取消暂存单个文件
- ✅ 丢弃变更
- ✅ 右键上下文菜单

### 3. Git 操作 ⭐⭐⭐
- ✅ 带提交信息的提交
- ✅ 从远端拉取提交
- ✅ 变基到目标分支
- ✅ 重置分支（soft/hard）
- ✅ 导出补丁

### 4. 提交历史视图 ⭐⭐
- ✅ 列出当前分支的提交
- ✅ 可展开以显示每个提交的文件
- ✅ 点击提交中的文件 → 查看 diff
- ✅ 操作：在编辑器中打开、回滚提交

### 5. 键盘快捷键 ⭐⭐
- `Cmd/Ctrl + K`：切换面板
- `Space`：暂存/取消暂存选中的文件
- `Enter`：显示 diff
- `↑/↓`：在文件间导航
- `Esc`：关闭面板

### 6. 自动提交模式 ⭐
- 切换以自动提交变更（用于 AI 工作流）
- 可配置的提交信息模板

## 实施计划

### 阶段 1：基础（第 1 周）
- [ ] 扩展数据模型以支持 staged/unstaged/commits
- [ ] 为 Git 操作新增后端 API
- [ ] 新增用于获取 diff 的端点

### 阶段 2：核心 UI（第 2 周）
- [ ] 构建带复选框的 Unstaged 区块
- [ ] 构建带操作的 Staged 区块
- [ ] 新增文件选择状态管理

### 阶段 3：提交与 Diff（第 3 周）
- [ ] 构建带可展开条目的 Commits 区块
- [ ] 新增内联 diff 查看器组件
- [ ] 集成 diff 加载与缓存

### 阶段 4：操作（第 4 周）
- [ ] 实现暂存/取消暂存/丢弃
- [ ] 实现提交创建 UI
- [ ] 实现 pull/rebase/reset 按钮

### 阶段 5：打磨（第 5-6 周）
- [ ] 新增键盘快捷键
- [ ] 新增错误处理与重试
- [ ] 新增加载状态
- [ ] 编写 E2E 测试
- [ ] 文档

## 成功指标

- ✅ 切换到外部 Git 工具的上下文切换减少 80%+
- ✅ 用户可在看板上完成完整的 Git 工作流
- ✅ 所有操作均可通过键盘访问
- ✅ 同时支持手动与 AI Agent 工作流

## 资源

- **GitHub Issue**: https://github.com/phodal/routa/issues/396
- **详细规格**: `docs/issues/2026-04-08-enhanced-git-workflow-ui-for-kanban-file-changes.md`
- **Intent 分析**: `docs/references/intent-0.2.11-file-changes-analysis.md`
- **当前实现**: `src/app/workspace/[workspaceId]/kanban/kanban-file-changes-panel.tsx`

## 后续步骤

1. ✅ Issue 已创建（#396）
2. ⏳ 团队评审并就范围达成一致
3. ⏳ 为每个阶段创建子任务
4. ⏳ 设计详细的原型图
5. ⏳ 开始阶段 1 实现
