---
title: 项目结构
---

# 项目结构

本页面面向高级用户、自托管用户和贡献者，帮助他们理解 Routa 各个运行时组件是如何协同工作的。如果你只是想开始使用 Routa，请返回 [Quick Start](/quick-start) 或 [Platforms](/platforms)。

Routa 是一个工作区优先的多 Agent 协调平台，包含两个主要运行时载体：

- `Web`：位于 `src/` 的 Next.js 应用和 API
- `Desktop`：位于 `apps/desktop/` 的 Tauri 应用，由 `crates/routa-server/` 中的 Axum 提供支撑

本项目刻意不是"两个独立的产品"。Web 端和桌面端在部署模型和存储方式上有所不同，但它们需要保持相同的领域语义、API 形态以及 Agent 协调行为。

## 主要路径

| 路径 | 用途 |
|---|---|
| `src/app/` | Next.js App Router 页面和 API 路由 |
| `src/client/` | 客户端组件、hooks 和 UI 协议辅助工具 |
| `src/core/` | TypeScript 领域逻辑、stores、ACP/MCP、看板、工作流、Trace、评审和 Harness 逻辑 |
| `apps/desktop/` | Tauri 外壳和打包 |
| `crates/routa-core/` | 共享的 Rust 运行时基础 |
| `crates/routa-server/` | 供桌面端和本地服务器模式使用的 Axum 后端 |
| `crates/routa-cli/` | CLI 命令和 ACP 服务入口 |
| `docs/` | 规范的公开文档、设计文档、ADR、发布文档和仓库指南 |

## 规范文档

在熟悉项目时，请优先使用以下文件：

- [Architecture](/ARCHITECTURE)：运行时拓扑和不变量
- [ADR Index](/adr)：持久化的架构决策
- [Code Style](/coding-style)：编码和测试约定
- [Product Specs](/product-specs/FEATURE_TREE)：自动生成的路由和端点清单
- [Design Docs](/design-docs)：规范化的设计意图和经过评审的产品决策

## 阅读顺序

1. 阅读 [Architecture](/ARCHITECTURE)。
2. 阅读 [ADR Index](/adr)。
3. 阅读 [Testing](/developer-guide/testing) 以理解验证模型。
4. 当你需要更深入的意图、权衡或迁移背景时，阅读 [Design Docs](/design-docs)。
