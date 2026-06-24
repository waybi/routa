---
title: Routa 的工作原理
---

# Routa 的工作原理

Routa 是一个面向软件交付的工作区优先（workspace-first）协调层。它不会把整个产品当作一段长时间运行的对话，
而是让执行过程始终附着在明确的产品对象和工作流边界上。

## 核心循环

从宏观上看，Routa 的工作方式如下：

1. 你进入一个工作区。
2. 你让一个 Provider 可用。
3. 你接入一个仓库或代码库。
4. 你通过 `Session`、`Kanban` 或 `Team` 开始工作。
5. Routa 记录执行状态，在需要时委派给专家（specialist），并保持工作可恢复。

## 主要产品对象

- `Workspace`：面向代码库、会话、任务、笔记和自动化的顶层作用域
- `Provider`：能够执行工作的运行时
- `Session`：默认的单线程优先执行模式
- `Kanban`：工作流驱动的模式，带有泳道自动化和质量门禁
- `Team`：由 lead 主导、用于多专家协调的模式
- `Specialist`：系统所使用的、聚焦于某个角色的 Agent 画像

## Routa 的不同之处

Routa 从产品结构出发来发起编排，而不是从单一的通用聊天窗口出发：

- `Sessions` 从一条可恢复的执行线程开始
- `Kanban` 从工作流状态和泳道转移开始
- `Team` 从一个负责协调的 lead 开始，由它分派子任务

这意味着，相比单纯的自由式提示，产品能够以一种更具可操作性的方式保留上下文、状态和执行意图。

## 继续阅读

- [执行模式](/design-docs/execution-modes)
- [使用 Routa](/use-routa)
- [架构](/ARCHITECTURE)
