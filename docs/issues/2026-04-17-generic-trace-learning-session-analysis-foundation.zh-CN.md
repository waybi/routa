---
title: "面向 Provider 无关的转录摄取的通用 Trace 学习会话分析基础设施"
date: "2026-04-17"
kind: issue
status: resolved
severity: medium
area: "trace-learning"
tags: ["trace-learning", "sessions", "codex", "feature-tree", "normalization", "rust"]
reported_by: "codex"
related_issues:
  - "docs/issues/2026-04-12-harness-monitor-task-tracking-from-codex-hooks.md"
  - "docs/issues/2026-04-16-global-kanban-flow-learning-via-agent-specialist.md"
  - "https://github.com/phodal/routa/issues/294"
github_issue: 478
github_state: closed
github_url: "https://github.com/phodal/routa/issues/478"
resolved_at: "2026-04-20"
resolution: "验收标准已通过 commit 832c71fe 中引入的通用会话归一化基础设施实现，并演进为当前的 trace-parser + feature-trace 拆分。"
---

# 面向 Provider 无关的转录摄取的通用 Trace 学习会话分析基础设施

## 发生了什么

Routa 已经拥有多个转录与 Trace 表面，但当前 Rust 侧的转录解析仍然是特定于具体实现的：

- `crates/harness-monitor` 包含特定于 Codex 的转录回填逻辑
- `routa-cli` 中现有的 Trace 学习聚焦于 Harness 演进 playbook，而非通用的会话分析
- 目前还没有一个可复用的 Rust 库，能够将来自不同 Agent Provider 的会话转录归一化为一个可扩展的模型

这使得支持与功能关联的会话管理变得困难，例如：

- 按 `docs/product-specs/FEATURE_TREE.md` 中的页面/API 表面对会话进行分组
- 跨 Provider 比较会话模式
- 将转录证据提升到更广义的 Trace 学习流水线中

## 预期行为

Routa 应当具备一个用于会话分析的通用 Rust 基础设施，它能够：

- 以独立于 Codex 特定 JSONL 形状的方式建模归一化的会话转录
- 允许 Provider 适配器将其各自的转录格式解析为一个共享的领域模型
- 从归一化会话中提取变更文件、提示词、工具使用情况以及其他可复用的证据
- 将变更文件映射到诸如页面和 API 等产品表面上

## 复现上下文

- 环境：两者皆是
- 触发条件：在分析本地 `~/.codex/sessions` 以评估一种新的、基于 feature-tree 的会话管理模型时，发现当前的解析器逻辑对于更广义的 Trace 学习目标而言复用性不足

## 可能的原因

- Codex 转录解析当前位于特定于产品的观察者路径中，而非一个可复用的 crate 内
- Trace 学习最初围绕 Harness playbook 演进，而非围绕 Provider 无关的会话归一化
- 代码库在原始转录事件与更高层级的 playbook 生成 / 功能归因之间缺少一个稳定的中间模型
- 与功能关联的会话分析目前依赖临时脚本，而非一个持久的 Rust 库边界

## 相关文件

- `docs/product-specs/FEATURE_TREE.md`
- `crates/harness-monitor/src/observe/codex_transcript.rs`
- `crates/routa-cli/src/commands/harness/engineering/learning.rs`
- `crates/trace-learning/`

## 观察

- 本地 Codex 会话 JSONL 中已经包含足够的信号，可以恢复会话元数据、用户提示词、工具调用以及文件变更证据。
- 如果将这些证据通过一个 Provider 无关的库边界暴露出来，它们可以支撑更广义的 Trace 学习用例。
- 与 feature-tree 关联的会话管理很可能需要多对多归因：一个会话可以触及多个表面，而一个表面可以聚合多个会话。

## 解决方案

- 当前的 `trace-parser` crate 中存在一个专门的 Rust 归一化边界，它导出 `NormalizedSession`、Provider 适配器以及 `AdapterRegistry`。
- Codex 转录通过 `CodexSessionAdapter` 解析为共享模型。
- 功能表面与 feature-tree 归因现在位于配套的 `feature-trace` crate 中，并由 `trace-parser` 和 `routa-server` 消费。
- 覆盖转录解析与功能表面映射的单元测试在当前代码树中通过（`cargo test -p trace-parser -p feature-trace`）。

## 参考

- https://github.com/phodal/routa/issues/478
- https://github.com/phodal/routa/issues/294
