---
title: "Kanban 看板/卡片操作在 Rust core RPC 中并非一等公民，这阻碍了 CLI 对等性并重复了工作流语义"
date: "2026-03-18"
status: resolved
resolved_at: "2026-03-18"
severity: medium
area: "kanban"
tags: ["kanban", "rust-core", "cli", "rpc", "architecture", "parity"]
reported_by: "codex"
github_issue: 192
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/192"
related_issues:
  - "docs/issues/2026-03-08-gh-96-feat-kanban-implement-generic-local-first-kanban-data-model.md"
  - "docs/issues/2026-03-14-kanban-story-lane-automation-stalls-after-first-session.md"
---

# Kanban 看板/卡片操作在 Rust core RPC 中并非一等公民，这阻碍了 CLI 对等性并重复了工作流语义

## 发生了什么

Routa 在 Rust 中已经拥有一个有实质意义的看板领域模型（`KanbanBoard`、`KanbanColumn`，以及任务的 `board_id` / `column_id` / `position`），并在 Web 技术栈中拥有更为丰富的看板工作流界面。然而，Rust 的 JSON-RPC 层目前仍仅暴露 Agent、任务、笔记、工作区和技能。

其结果是：

- CLI 无法像处理其他实体那样，通过同一套 `routa-core` RPC 接口将看板和卡片作为一等概念来管理；
- 看板行为被拆分到多个实现之中：
  - Rust core 的数据/存储模型
  - Rust server 的 HTTP/MCP 处理器
  - TypeScript 的看板工具与路由处理器
- 诸如默认看板解析、列校验、任务状态映射和卡片塑形等看板/卡片语义被重复实现，而不是在一个共享的核心契约中定义一次。

## 为何重要

这与既定的 CLI 设计——即 CLI 应当是 `routa-core` 之上的一层薄适配器——产生了架构上的不一致。

当前的形态带来了若干风险：

- CLI 用户无法像使用任务/工作区那样使用看板。
- Rust server 路由和 MCP 处理器继续持有本应属于共享核心服务或 RPC 方法的业务逻辑。
- 未来的看板变更更有可能在 Rust 与 TypeScript 实现之间产生漂移。
- 由于共享后端契约不完整，看板的控制面方向变得更难稳定下来。

## 预期行为

- Rust core 应当为看板和卡片操作暴露一等的 `kanban.*` RPC 方法。
- CLI 应当通过薄命令适配器消费这些 RPC 方法。
- 共享的看板/卡片语义应当存在于 Rust core 中，而不是在特定于 server 的处理器中重复实现。

## 相关文件

- `crates/routa-core/src/models/kanban.rs`
- `crates/routa-core/src/models/task.rs`
- `crates/routa-core/src/store/kanban_store.rs`
- `crates/routa-core/src/rpc/router.rs`
- `crates/routa-core/src/rpc/methods/tasks.rs`
- `crates/routa-server/src/api/kanban.rs`
- `crates/routa-server/src/api/mcp_routes.rs`
- `crates/routa-cli/src/main.rs`
- `crates/routa-cli/src/commands/mod.rs`

## 备注

本 issue 关注的是共享后端契约与 CLI 对等性，而非完整的看板自动化。Story 级别的工作流执行、泳道/会话生命周期以及自动化可靠性仍属于更广泛的后续关注点。

## 解决方案

本 issue 已在当前代码库中解决，上游 GitHub issue 也已关闭。

当前实现中的证据：

- `crates/routa-core/src/rpc/router.rs` 现已暴露一等的 `kanban.*`
  方法，涵盖看板、卡片、列、查询、拆解和交接等操作。
- `crates/routa-core/src/rpc/methods/kanban.rs` 及其子模块包含了
  共享的 Rust 侧实现，而非将这些语义留给仅 server 端的处理器。
- `crates/routa-cli/src/commands/kanban.rs` 通过薄命令适配器消费这些
  RPC 方法，符合预期的 CLI 架构。

更广泛的看板自动化可靠性仍是一个独立的后续工作面，但
这里所描述的契约/对等性缺口已不再悬而未决。
