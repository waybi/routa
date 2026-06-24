---
title: 核心概念总览
---

# 核心概念

Routa 并不是一个在四周加了些按钮的单一聊天窗口。它是一个面向软件交付、以工作区为先的协调系统。

## 产品模型

首先需要理解的稳定概念有：

- `Workspace`：代码库、会话、任务、笔记和自动化的顶层边界
- `Session`：由某个 Provider 支撑、限定在工作区范围内的执行线程
- `Kanban`：由看板驱动的协调与泳道自动化界面
- `Team`：一种协调式的多 Agent 执行模式
- `Provider`：通过 ACP 或归一化适配器执行工作的运行时
- `Specialist`：在流程中承担特定职责的命名角色

## 推荐的后续阅读

- [Routa 的工作原理](/core-concepts/how-routa-works)
- [使用 Routa](/use-routa)
- [架构](/ARCHITECTURE)
- [执行模式](/design-docs/execution-modes)
- [架构决策](/adr)
- [Provider 与模型](/configuration/providers-and-models)

## 本章节存在的意义

入门指南告诉你如何运行 Routa。核心概念则告诉你在 Routa 运行起来之后，应该如何去理解它。
