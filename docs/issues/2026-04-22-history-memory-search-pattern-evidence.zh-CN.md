---
title: "Backlog/历史记忆检索缺乏来自真实 Codex 搜索行为的证据"
date: "2026-04-22"
kind: issue
status: resolved
severity: medium
area: kanban
tags:
  - history-memory
  - backlog-refiner
  - codex-sessions
  - search-patterns
reported_by: "codex"
related_issues:
  - "2026-04-21-task-adaptive-harness-kanban-backlog-refine-and-card-detail.md"
  - "2026-04-21-jit-context-needs-repo-root-context-discovery.md"
github_issue: 523
github_state: closed
github_url: "https://github.com/phodal/routa/issues/523"
---

# Backlog/历史记忆检索缺乏来自真实 Codex 搜索行为的证据

## 发生了什么

当前的 `History Memory` / 任务自适应检索主要依赖标题/查询/特性/文件提示以及 feature-tree 兜底，但仍然缺乏一个有证据支撑的模型，来说明编码 Agent 在开始收窄范围时最先实际搜索的是什么。

仓库中已经存在用于会话审查的 Trace 工具，但还没有专门针对 `~/.codex/sessions`、聚焦于类 grep/glob 搜索行为的分析。因此，看板 backlog 规划与历史记忆预加载仍然由产品假设塑造，而不是由真实编码会话中观察到的搜索模式塑造。

## 期望行为

我们应当拥有一个可重复的 Trace 分析，能够回答如下问题：

- Agent 最常使用哪些类 grep/glob 的搜索族（`rg`、`rg --files`、`find`、`fd` 等）
- 他们最常搜索哪些模式（符号名、路由片段、文件后缀 glob、自然语言短语）
- 哪些路径根目录或 glob 出现得最频繁（`src/`、`crates/`、`docs/`、`*.tsx`、`*.rs` 等）
- 这些证据是否支持让 backlog refiner 先生成一个检索条件，再持久化任务级别的 `contextSearchSpec`

## 复现上下文

- 环境：Web 端 / 本地 Node 开发
- 触发：试图决定看板 backlog refiner 应该预填检索提示，还是先通过 Agent 驱动的仓库审查来生成它们

## 为什么可能会发生

- 我们已经为特性/任务自适应恢复解析 Trace，但还没有用于搜索意图统计
- 当前的预加载阈值衡量的是匹配强度，而不是底层检索条件是否贴近真实 Agent 的搜索行为
- backlog 规划最近升级为允许 `Read`、`Grep` 和 `Glob`，但我们仍然缺乏关于这些搜索在实践中通常长什么样的证据

## 相关文件

- `scripts/harness/analyze-search-tool-usage.ts`
- `scripts/__tests__/analyze-search-tool-usage.test.ts`
- `src/core/harness/transcript-sessions.ts`
- `src/core/kanban/context-preload.ts`
- `src/core/kanban/agent-trigger.ts`

## 观察

- 本机的 `~/.codex/sessions` 当前包含 `1892` 个 Trace 文件。
- 一次按仓库过滤的扫描（`--cwd-contains routa-js`）发现：
  - `841` 个包含类 grep/glob 搜索的会话
  - `20900` 个搜索事件
  - `18535` 次 `rg` 文本搜索（`88.7%`）
  - `1338` 次 `find` 搜索（`6.4%`）
  - `682` 次 `rg --files` 搜索（`3.3%`）
  - `343` 次纯 `grep` 搜索（`1.6%`）
  - `0` 次一等公民的自定义 `grep` / `glob` MCP 工具调用
- 这意味着真实的 Codex 搜索行为绝大多数是 shell 驱动的，并以 `rg` 为中心，而非依赖独立的 MCP grep/glob 原语。
- 搜索意图是混合的，而非纯语义的：
  - `symbol_like`：`6558`
  - `natural_language`：`6221`
  - `path_like`：`4553`
- 最常见的 glob 高度偏向代码表层：
  - `*.ts`（`744`）
  - `*.rs`（`622`）
  - `*.tsx`（`556`）
  - `*.md`（`238`）
  - 此外还有强烈偏测试的 glob，如 `*test*`、`*.test.ts`、`*.test.tsx`
- 最常见的路径根目录为：
  - `src`（`17666`）
  - `crates`（`6872`）
  - `docs`（`2272`）
  - `tools`（`1031`）
  - `scripts`（`620`）
  - `apps`（`529`）
- 最常见的文件枚举命令都是根目录优先的：
  - `rg --files src`
  - `rg --files docs/issues`
  - `rg --files src/app`
  - `rg --files crates/routa-server/src`
  - `find resources/specialists -maxdepth 3 -type f`
- 具有代表性的高信号搜索会话呈现出相同的模式：
  - 先枚举可能的根目录/文件
  - 然后发起密集的 `rg -n` 符号/路由/契约搜索
  - 再用 `Read`/`sed` 在候选文件上收窄

## 影响

这些结果支持以更显式的方式改变看板 backlog 精炼流程：

1. `backlog refiner` 不应以仅凭卡片标题猜测出的、已持久化的 `contextSearchSpec` 作为起点。
2. 它应当改为生成一个临时的检索/搜索条件并执行它：
   - 可能的根目录（`src`、`crates`、`docs`、`resources`、`tools`）
   - 可能的文件 glob（`*.ts`、`*.tsx`、`*.rs`、测试）
   - 可能的符号/模块/路由术语
3. 只有在完成仓库审查之后，它才应持久化一个已确认的 `contextSearchSpec`，尤其是：
   - `featureCandidates`
   - `relatedFiles`
   - `moduleHints`
   - `symptomHints`
4. 这也表明，对新建 backlog 卡片的自动预加载应保持保守；持久化检索提示的更高价值时机，是在 Agent 已对仓库执行过 `rg --files` / `rg -n` 之后。

在验证过程中有一点变得清晰：原始的高频 glob（如 `*.ts`、`*.tsx`、`*.rs`）过于通用，不能直接作为 backlog 检索种子使用。它们作为「Agent 会广泛搜索代码表层」的证据仍然有用，但更具可操作性的信号是：

- 根目录优先的枚举命令，如 `rg --files src/app`、`rg --files crates/routa-server/src`、`rg --files src/core`、`find resources/specialists -maxdepth 3 -type f`
- 收窄的结构性 glob，如 `route.ts`、`*.test.ts`、`*.test.tsx`、`Cargo.toml`、`package.json`、`*.jsonl`
- 稳定的代码表层根目录：`src`、`crates`、`resources`、`tools`、`scripts`、`apps`

分析脚本现在会将这些以 `topEnumerationCommands`、`topActionableGlobs` 和 `topActionablePathRoots` 的形式输出，以便未来的 backlog-refiner 工作可以消费更高信号的种子，而不是通用的文件扩展名。

## 验证

- 2026-04-22：新增 `scripts/harness/analyze-search-tool-usage.ts`
- 2026-04-22：新增 `scripts/__tests__/analyze-search-tool-usage.test.ts`
- 2026-04-22：`npx vitest run scripts/__tests__/analyze-search-tool-usage.test.ts` 通过（`7` 个测试）
- 2026-04-22：执行真实扫描：
  - `npx tsx scripts/harness/analyze-search-tool-usage.ts --cwd-contains routa-js --max-items 25`
- 按仓库过滤的输出即为上述计数的证据来源
- 2026-04-22：实现 backlog 确认门控，除非当前 backlog 会话已经审查过仓库或调用过 `load_feature_tree_context`，否则会剥离推测性的 `contextSearchSpec`
- 2026-04-22：更新看板 backlog 提示词与 MCP 工具描述，要求在持久化 `contextSearchSpec` 之前先获得已确认的检索提示
- 2026-04-22：`npx vitest run src/core/kanban/__tests__/backlog-context-confirmation.test.ts src/core/tools/__tests__/kanban-tools.test.ts src/core/tools/__tests__/agent-tools.test.ts 'src/app/workspace/[workspaceId]/kanban/__tests__/kanban-agent-input.test.ts' src/core/kanban/__tests__/agent-trigger.test.ts` 通过（`53` 个测试，`2` 个跳过）
- 2026-04-22：`npx tsc --noEmit` 通过
- 2026-04-22：`entrix run --tier fast` 通过（`100.0%`）
- 2026-04-22：完善 `analyze-search-tool-usage.ts`，使其输出 `topActionableGlobs`、`topActionablePathRoots` 和 `topEnumerationCommands`，并显式降级如 `*.ts` / `*.rs` 这类通用 glob
- 2026-04-22：`npx vitest run scripts/__tests__/analyze-search-tool-usage.test.ts` 通过（`10` 个测试）

## 参考

- `docs/issues/2026-04-21-task-adaptive-harness-kanban-backlog-refine-and-card-detail.md`
- `docs/issues/2026-04-21-jit-context-needs-repo-root-context-discovery.md`
