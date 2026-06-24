---
title: 贡献指南
---

# 贡献指南

本页面仅在你计划直接为 Routa 本身做贡献时才需要阅读。如果你只是想使用、配置或自托管 Routa，请改为从 [Quick Start](/quick-start)、[Configuration](/configuration) 或 [Administration](/administration) 入手。

## 开始之前

- 阅读 [Architecture](/ARCHITECTURE) 了解运行时边界。
- 阅读 [Code Style](/coding-style) 了解实现规范。
- 在开始提交之前阅读 [Git Workflow](/developer-guide/git-workflow)。
- 保持改动聚焦，并尽量做到一个提交只处理一个关注点。

## 本地搭建

### Web 端

```bash
npm install --legacy-peer-deps
npm run dev
```

### 桌面端

```bash
npm install --legacy-peer-deps
npm --prefix apps/desktop install
npm run tauri:dev
```

## 开发预期

- 遵循 [Testing](/developer-guide/testing) 中描述的 lint、测试和评审规则。
- 不要将无关的重构与功能或缺陷修复改动混在一起。
- 当公开行为、命令或工作流发生变化时，更新文档。

## Pull Request

- 说明对用户可见的变更及其理由。
- 为 UI 改动附上截图或录屏。
- 列出你运行过的检查。
- 在适用时关联相关的 issue。

## 缺陷与安全

- 使用 [GitHub Issues](https://github.com/phodal/routa/issues) 提交缺陷和功能请求。
- 使用 [SECURITY.md](https://github.com/phodal/routa/blob/main/SECURITY.md) 提交涉及安全的报告。
