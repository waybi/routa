---
title: "Task-Adaptive 历史相关性应在嵌套 cwd 路径间保持工具调用的连续性"
date: "2026-04-23"
kind: issue
status: resolved
severity: medium
area: harness
tags:
  - task-adaptive
  - codex-sessions
  - transcript-analysis
  - relative-paths
  - tool-continuity
reported_by: "user"
github_issue: 528
github_state: closed
github_url: "https://github.com/phodal/routa/issues/528"
---

# Task-Adaptive 历史相关性应在嵌套 cwd 路径间保持工具调用的连续性

## 发生了什么

原始 GitHub issue 的标题过度聚焦于将每个文件路径归一化为相对于仓库根目录的形式。真正的意图更狭窄，也更偏行为层面：Task-Adaptive 历史分析应当理解来自 `~/.codex/sessions` 的常规本地 Agent 工作流，尤其是诸如以下的工具调用序列：

- 使用 `rg --files`、`rg`、`grep`、`find` 或 `fd` 搜索或枚举文件
- 读取返回的某个相对路径
- 通过 `apply_patch` 编辑同一路径
- 使用这些彼此关联的信号将该会话排名为相关

在真实的 Codex Trace 中，有些会话的 `cwd` 位于嵌套的代码库路径下，例如 `.routa/repos/<codebase>`。像 `packages/app/src/page.tsx` 这样的路径相对于该会话的 `cwd` 是正确的，但相对于 Routa 仓库根目录就不正确了。如果 Task-Adaptive 将原始 token 保留为 `packages/app/src/page.tsx`，它就无法匹配存储为 `.routa/repos/<codebase>/packages/app/src/page.tsx` 的已选文件。

## 预期行为

当会话运行在嵌套仓库路径内时，Task-Adaptive Trace 分析应先将文件路径视为相对于会话 `cwd`，然后再将其转换回相对于当前仓库根目录的形式，以用于匹配和排名。

它还应保留足够的工具调用连续性，将搜索结果计为有用的发现/读取信号，从而让一个常规的 `rg -> sed -> apply_patch` 序列提升相关性，而不是被拆分成互不关联的事件。

## 为什么会发生

- `normalizeRepoRelative` 在考虑 `sessionCwd/token` 可能才是真正目标之前，就返回了原始相对 token。
- 此前会先相对于会话 cwd 而非当前仓库根目录来检查绝对路径，这也可能剥离掉嵌套仓库前缀。
- 类搜索命令的输出被忽略，没有作为文件发现的证据。
- `parsePatchBlock` 未能匹配真实的 `apply_patch` 头部，如 `*** Update File: ...`，因此被编辑的文件可能被完全遗漏。

## 相关文件

- `src/core/harness/task-adaptive.ts`
- `src/app/api/harness/task-adaptive/__tests__/shared.test.ts`

## 验证

- 2026-04-23：为带嵌套 `cwd` 的 Trace（`rg --files -> sed -> apply_patch`）新增了一个回归测试。
- 2026-04-23：`npx vitest run src/app/api/harness/task-adaptive/__tests__/shared.test.ts` 通过。
- 2026-04-24：在 `main` 上重新验证，确认提交 `2b52fc46` 已经覆盖了 `src/core/harness/task-adaptive.ts` 中嵌套 `cwd` 路径的连续性。
- 2026-04-24：在 `src/core/harness/__tests__/task-adaptive-path-signals.test.ts` 中为 `parsePatchBlock`、`normalizeRepoRelative` 以及搜索输出发现新增了直接的辅助函数回归测试。
- 2026-04-24：`npx vitest run src/core/harness/__tests__/task-adaptive-path-signals.test.ts src/app/api/harness/task-adaptive/__tests__/shared.test.ts` 通过。
- 2026-04-24：`entrix run --tier fast` 通过。
