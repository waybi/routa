---
title: "首页与看板入口面碎片化"
date: 2026-03-19
agent: Codex (GPT-5)
status: resolved
resolved_at: "2026-03-19"
severity: medium
area: frontend
tags: [homepage, kanban, workspace, information-architecture, ux]
github_issue: 203
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/203"
---

# 首页与看板入口面碎片化

## 发生了什么

Routa 的主要操作面已经转向看板，但 UI 仍然呈现三个相互竞争的入口：

1. `/` 表现得像一个启动器，同时还渲染由看板派生的看板/任务遥测数据
2. `/workspace/{workspaceId}` 表现得像第二个仪表盘，并将看板作为默认标签页嵌入
3. `/workspace/{workspaceId}/kanban` 表现得像真正的生产工作面

这让产品在"工作应该从哪里开始、又应该在哪里继续"这一点上显得犹豫不决。

## 为什么重要

本地 issue 文件：`docs/issues/2026-03-19-homepage-kanban-entry-surface-fragmentation.md`

- 用户会看到重复的任务入口面，以及重复的工作区/任务摘要
- 导航语义薄弱："打开工作区"和"打开看板"会导向相互重叠的体验
- 看板在 UI 文案中被定位为核心面，但路由层级仍将其视为众多标签页中的一个
- 首页测试和产品文案正在产生漂移，因为首页同时被当作落地页、启动器和看板摘要

## 可观察到的症状

- `HomeInput` 在多个入口面中被渲染
- 首页会抓取看板/任务快照并预览活跃泳道，而不是保持为一个聚焦的启动器
- 工作区页面默认进入看板标签页，与独立的看板路由重复
- 测试预期仍然编码了多种首页叙事（`Kanban-First Control Surface`、`Open board`、以及更早的 `Kanban Core` 文案）

## 可能涉及的文件

- `src/app/page.tsx`
- `src/client/components/home-page-sections.tsx`
- `src/app/workspace/[workspaceId]/page.tsx`
- `src/app/workspace/[workspaceId]/workspace-page-client.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx`
- `e2e/layout-verification.spec.ts`
- `e2e/homepage-open-board-tauri.spec.ts`

## 期望的方向

- 将 `/` 保持为全局启动器，用于工作区选择、新需求录入以及最近活动恢复
- 让 `/workspace/{workspaceId}/kanban` 成为任务执行的规范操作面
- 减少或移除 `/workspace/{workspaceId}` 中的看板重复
- 围绕单一主工作流对齐路由语义、文案和测试

## 进展记录

- 阶段 1：首页不再渲染看板快照/控制摘要面
- 阶段 2：`/workspace/{workspaceId}` 已从第二个看板外壳转换为真正的概览面
- 阶段 3：桌面端导航语义统一为 `Overview / Kanban / Traces`
- 当前决策：将 `/workspace/{workspaceId}` 保留为概览路由而非重定向，因为它仍提供与活跃看板执行不同的恢复/上下文功能

## 解决方案

该问题在当前代码库中已解决，上游 GitHub issue 也已关闭。

当前实现中的证据：

- `src/app/workspace/[workspaceId]/page.tsx` 现在将工作区根路径重定向到
  `/workspace/{workspaceId}/kanban`，使看板成为规范的操作面。
- `src/app/workspace/[workspaceId]/overview/page.tsx` 将概览保留为显式的同级路由，
  而不是第二个隐式的看板外壳。
- `src/client/components/desktop-sidebar.tsx` 暴露了独立的 `Kanban`、
  `Overview` 和 `Team` 导航条目，从主桌面外壳中消除了此前的路由
  歧义。
