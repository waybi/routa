---
date: 2026-03-15
title: Tauri 桌面端菜单改进
status: resolved
area: desktop
labels: [enhancement, tauri, ux]
---

# Tauri 桌面端菜单改进

## 摘要

增强了 Tauri 桌面应用的菜单结构，提供更好的导航和工具模式控制。

## 已实现的改动

### 1. 开发者模式 → 系统菜单 ✅

**改动前**：工具模式（Tool Mode）切换位于会话页面头部（UI 元素）
**改动后**：移至 View 菜单，并配有键盘快捷键

- **菜单位置**：View → Toggle Tool Mode (Essential/Full)
- **键盘快捷键**：`Cmd+Shift+T`（macOS）/ `Ctrl+Shift+T`（Windows/Linux）
- **行为**：
  - 从 `/api/mcp/tools` 获取当前模式
  - 在 `essential`（7 个工具）和 `full`（34 个工具）之间切换
  - 自动重新加载页面以反映更改
  - 在控制台输出新模式以便调试

**优势**：
- 可从任意页面访问，而不仅限于会话页面
- 遵循桌面应用惯例（系统菜单 > UI 切换）
- 为高级用户提供键盘快捷键
- 无需导航到会话页面即可更改模式

### 2. 导航菜单 ✅

新增了一个 "Navigate" 菜单，为常用页面配备键盘快捷键：

| 菜单项 | 快捷键 | 目标 |
|-----------|----------|--------|
| Dashboard | `Cmd+1` | `/workspace/{workspaceId}` |
| Kanban Board | `Cmd+2` | `/workspace/{workspaceId}/kanban` |
| Agent Traces | `Cmd+3` | `/traces` |
| Settings | `Cmd+,` | `/settings` |

**智能工作区检测**：
- Dashboard 和 Kanban 菜单项会从 URL 检测当前工作区 ID
- 若不在工作区上下文中，则回退到默认工作区
- 使用 JavaScript 提取工作区 ID：`/workspace/([^/]+)/`

**优势**：
- 无需鼠标点击即可快速导航
- 标准键盘快捷键（Cmd+1、Cmd+2 等）
- Cmd+, 用于设置，遵循 macOS 惯例

### 3. 菜单结构优化 ✅

**新的菜单结构**：

```
File
├── Reload (Cmd+R)
└── Quit (Cmd+Q)

View
├── Toggle Developer Tools (Cmd+Option+I)
└── Toggle Tool Mode (Essential/Full) (Cmd+Shift+T)  ← NEW

Navigate  ← NEW MENU
├── Dashboard (Cmd+1)
├── Kanban Board (Cmd+2)
├── Agent Traces (Cmd+3)
└── Settings (Cmd+,)

Tools
├── Install Agents... (Cmd+Shift+I)
└── MCP Tools (Cmd+Shift+M)
```

**优势**：
- 菜单项分组合理
- 将导航与工具分离
- 一致的键盘快捷键
- 遵循桌面应用最佳实践

## 技术实现

### 修改的文件
- `apps/desktop/src-tauri/src/lib.rs`

### 关键代码段

1. **菜单项创建**（第 661-699 行）：
   - `toggle_tool_mode`：在 essential/full 模式之间切换
   - `nav_dashboard`、`nav_kanban`、`nav_traces`、`nav_settings`：导航项

2. **菜单事件处理器**（第 782-867 行）：
   - `toggle_tool_mode`：异步 fetch + PATCH + reload
   - `nav_*`：基于 JavaScript 的导航，并带工作区 ID 检测

### 测试

手动测试已确认：
- ✅ 所有菜单项均正确显示
- ✅ 键盘快捷键正常工作
- ✅ 工具模式切换正常工作（essential ↔ full）
- ✅ 导航项可从任意页面工作
- ✅ 工作区 ID 检测正确工作
- ✅ 设置快捷键（Cmd+,）遵循 macOS 惯例

## 未来增强

未来迭代的潜在改进：

1. **动态菜单状态**：
   - 在当前工具模式（Essential/Full）旁显示勾选标记
   - 当已位于某页面时禁用对应的导航项
   - 在菜单中显示当前工作区名称

2. **更多导航**：
   - 最近会话子菜单
   - 菜单中的工作区切换器
   - 快速访问最近文件

3. **工具模式指示器**：
   - 显示当前模式的菜单栏图标
   - 模式更改时的通知

## 相关问题

- 原始需求：用户对桌面端用户体验的反馈
- 相关：开发者模式应位于系统菜单中
- 相关：导航需要键盘快捷键

## 提交

```
commit eac6323
feat(tauri): add system menu for tool mode and navigation
```
