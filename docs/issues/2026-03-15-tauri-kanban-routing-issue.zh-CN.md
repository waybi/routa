---
title: "Tauri 看板路由问题"
date: 2026-03-15
agent: Augment Agent (Claude Sonnet 4.5)
status: resolved
severity: high
area: desktop
component: tauri-frontend
---

# Tauri 看板路由问题

## 问题

在 Tauri 桌面端应用的主页点击「Open board」时，URL 变为 `/workspace/{id}/kanban`，但页面显示的却是工作区详情页（带有 HomeInput 和标签页），而非独立的看板页面。

## 根本原因

Next.js 静态导出只生成了占位路径：
- `/workspace/__placeholder__`
- `/workspace/__placeholder__/kanban`

当访问类似 `/workspace/8844519a-5f3c-437c-aac4-286d2e7517a7/kanban` 这样的真实工作区 ID 时，Rust 后端找不到对应的静态 HTML 文件，于是回退并提供了错误的页面。

## 证据

### 预期行为（运行在 3000 端口的 Next.js 开发服务器）
- 干净的看板页面，仅包含：
  - 顶部导航栏
  - 用于创建任务的小输入框
  - 看板列（Backlog、Todo、Dev 等）
  - 没有大型 HomeInput 组件
  - 没有标签页（Kanban/Notes/Activity）

### 实际行为（运行在 3210 端口的 Tauri/Rust 后端）
- 工作区详情页，包含：
  - 大型 HomeInput 组件（"What are you working on?"）
  - 三个标签页：Kanban、Notes、Activity
  - 标签页下方显示的看板
  - URL 显示为 `/workspace/{id}/kanban`，但内容来自 `/workspace/{id}`

## 测试结果

E2E 测试截图：`test-results/tauri-homepage-03-kanban-page.png`

页面快照显示：
- 第 32-66 行：HomeInput 组件（不应出现）
- 第 91-93 行：标签页按钮（不应出现）
- 第 110-146 行：看板列（正确，但处于错误的上下文中）

## 影响

- 用户无法在 Tauri 应用中访问独立的看板视图
- 导航令人困惑（URL 显示 `/kanban`，但展示的是工作区页面）
- 破坏了预期的用户流程：主页 → Open board → 看板页面

## 可能的解决方案

1. **客户端路由**：使用 Next.js 客户端路由处理动态工作区 ID
2. **回退 HTML**：配置 Rust 后端提供一个通用的回退 HTML，由客户端处理路由
3. **SPA 模式**：将 Next.js 构建为真正的 SPA，使用单一 `index.html` 并由客户端路由
4. **预生成常用路径**：为常用工作区 ID 生成静态 HTML（不可扩展）

## 相关文件

- `src/app/workspace/[workspaceId]/kanban/page.tsx` - 看板页面组件
- `src/app/workspace/[workspaceId]/page.tsx` - 工作区详情页
- `crates/routa-server/src/lib.rs` - Rust 后端静态文件服务
- `next.config.ts` - Next.js 静态导出配置

## 解决方案

**修复提交：** [pending]

该问题通过更新 Rust 后端在 `crates/routa-server/src/lib.rs` 中的静态文件服务逻辑得以解决，使其能够正确地将 `/workspace/{workspaceId}/kanban` 路由映射到 `workspace/__placeholder__/kanban.html`。

### 所做更改

1. 在回退服务中添加了看板路由处理：
   ```rust
   } else if segments.len() == 2 && segments[1] == "kanban" {
       // /workspace/{workspaceId}/kanban[.txt]
       (
           format!("workspace/__placeholder__/kanban.{}", ext),
           content,
       )
   }
   ```

2. 更新注释以记录看板路由映射

### 验证

- ✅ E2E 测试 `e2e/homepage-open-board-tauri.spec.ts` 现已通过
- ✅ 看板页面在 Tauri 后端（3210 端口）上正确加载
- ✅ 导航至看板时不再显示工作区详情页
- ✅ 页面内容正确：看板列、任务输入框，无 HomeInput 组件
