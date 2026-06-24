---
title: "看板 Git Log 面板返回空数据或一直处于加载状态"
date: "2026-04-09"
status: resolved
severity: medium
area: "ui"
tags: ["kanban", "git-log", "multi-repo", "nextjs", "rust-parity"]
reported_by: "github-copilot"
related_issues:
  - "2026-04-08-enhanced-git-workflow-ui-for-kanban-file-changes.md"
  - "https://github.com/phodal/routa/issues/407"
---

# 看板 Git Log 面板返回空数据或一直处于加载状态

## 发生了什么

新的看板 Git Log 面板能够渲染其外壳和 refs 树，但提交列表要么保持为空，要么停留在加载状态。

验证过程中观察到的故障表现：

- 对于明显存在历史记录的仓库，`/api/git/log` 返回了 `{ commits: [], total: 0, hasMore: false }`。
- 在首次修复 API 之后，浏览器 UI 仍可能停留在 `Loading...`，因为客户端 hook 会在仓库变化时重新触发自己的加载周期。
- 在多仓库（multi-repo）配置下，面板最初只跟随默认 codebase，并没有暴露专门的仓库切换器。

## 预期行为

看板 Git Log 面板应当：

- 显示当前所选仓库的提交，
- 支持分支以及 hash/文本过滤，
- 内联打开提交详情，
- 并且在工作区包含多个 codebase 时支持显式的仓库切换。

## 复现上下文

- 环境：web
- 触发方式：打开 `/workspace/default/kanban`，展开 `Git Log`，观察到提交列表为空或永久加载
- 验证上下文：
  - 真实工作区 codebase：`/Users/phodal/ai/routa-js/.routa/repos/phodal--routa`
  - 用于验证多仓库切换的临时第二个 codebase：`/Users/phodal/ai/routa-js`

## 可能的原因

- 列表端点使用 `%B` 序列化提交正文文本，然后逐行解析输出。多行提交正文破坏了记录解析，导致有效的提交被丢弃。
- 前端 hook 在一个同时依赖派生日志加载器的 effect 内部重置了 `activeBranches`，这可能造成自触发的加载循环。
- 该面板最初只读取默认 codebase 的路径，因此多仓库行为是隐式的而非显式的。
- 在 Rust 服务端暴露出与之匹配的根级别 `/api/git/refs`、`/api/git/log` 和 `/api/git/commit` 路由之前，桌面端/运行时一致性存在差距。

## 相关文件

- `src/app/api/git/log/route.ts`
- `src/app/api/git/refs/route.ts`
- `src/app/workspace/[workspaceId]/kanban/git-log/use-git-log.ts`
- `src/app/workspace/[workspaceId]/kanban/git-log/git-log-panel.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-tab-panels.tsx`

## 观察结果

- 修复后直接对 API 进行验证，两个仓库均返回了提交数据。
- Rust 一致性验证通过对 `routa-server` 的实时请求（访问 `/api/git/refs`、`/api/git/log` 和 `/api/git/commit`，包括 `branches=origin/main` 远程过滤）确认了相同的契约。
- 浏览器验证确认了：
  - 提交列表渲染，
  - 提交详情渲染，
  - hash 搜索，
  - 分支过滤状态，
  - 多仓库的仓库选择器与仓库切换行为。
- 验证期间使用的临时第二个 codebase 在测试后被移除，以恢复工作区状态。

## 参考

- 实现过程中捕获的浏览器验证产物。
- 后续 GitHub issue 最初用于跟踪该面板的 Rust 后端一致性：https://github.com/phodal/routa/issues/407
