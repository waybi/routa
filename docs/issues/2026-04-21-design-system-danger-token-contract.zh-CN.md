---
title: "品牌色板与共享组件之间缺失设计系统危险态 token 契约"
date: "2026-04-21"
kind: issue
status: resolved
severity: medium
area: "design-system"
tags:
  - design-system
  - tokens
  - button
  - desktop
  - ui
reported_by: "codex"
related_issues:
  - "2026-03-17-design-system-unified-desktop-sidebar-theme-routing.md"
  - "2026-03-17-design-system-quality-gates.md"
github_issue: 514
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/514"
resolved_at: "2026-04-21"
---

# 品牌色板与共享组件之间缺失设计系统危险态 token 契约

## 发生了什么

- 仓库已在 `src/app/globals.css` 中定义了红色品牌色板（`--brand-red-*` 与 `--brand-red`），桌面端主题接线也已暴露 `--dt-brand-red`。
- 然而，共享 UI 组件仍普遍直接消费原始的 Tailwind `red-*` / `rose-*` 色板类，而不是一套语义化的危险态 token 契约。
- 这使得设计系统从使用侧看起来并不完整：色板存在，但破坏性/错误类 UI 并没有始终如一地通过一个可复用的 token 入口进入。
- 共享的 `Button` 组件就是一个具体例子：它的 `danger` 变体目前硬编码了 Tailwind 红色类，而不是消费设计系统变量。

## 预期行为

- 破坏性和错误类 UI 应当拥有一等公民级别的语义 token 契约，而不只是原始的品牌红色板。
- 共享组件应优先消费该契约，以便下游 UI 无需重新决定原始 red/rose 取值即可继承危险态行为。
- 桌面端主题和 Storybook 的 token 文档应足够清晰地暴露同一套契约，使后续工作能够向其收敛。

## 复现上下文

- 环境：Web 端 + 桌面端
- 触发方式：
  - 检查 `src/app/globals.css`，可观察到 `--brand-red-*` 已存在
  - 检查共享组件，例如 `src/client/components/button.tsx`
  - 观察到破坏性/错误状态仍在使用直接的 `bg-red-*` / `text-red-*` / `border-rose-*` 工具类，而非语义化 token 变量

## 可能的原因

- 早期的设计系统工作先建立了品牌色板和桌面端外壳 token，但没有为共享内容组件完成语义化的危险态分层。
- 现有的 lint 聚焦于外壳组件和提示性扫描，尚未强制每个共享组件都迁移到语义化危险态别名。
- 在功能开发时，red/rose 工具类很容易顺手使用，因此即便色板已经存在，使用上的漂移仍会不断累积。

## 相关文件

- `src/app/globals.css`
- `src/app/styles/desktop-theme.css`
- `src/client/components/button.tsx`
- `src/client/components/button.stories.tsx`
- `src/client/components/desktop-color-tokens.stories.tsx`
- `scripts/lint-design-system-css.mjs`
- `docs/fitness/design-system-quality-layers.md`

## 观察

- 当前的问题并不是仓库是否存在任何红色取值；它是有的。
- 真正的缺口在于：`brand-red` 是一个色板 token，而共享组件仍缺少一个稳定的语义入口，例如 `danger-solid`、`danger-border`、`danger-fg` 及相关别名。
- 该问题应当增量式地解决：
  - 首先建立语义契约，
  - 然后迁移共享原语，
  - 最后再收紧更严格的 lint 覆盖。
- 2026-04-21 第一阶段工作新增了语义化的 `--danger-*` 别名，将其映射进桌面端主题契约，并将共享的 `Button` 危险态变体迁移到了新的 token 入口。
- 2026-04-21 第二阶段工作新增了共享的 `src/client/components/color-system.ts` 辅助模块，并将 `settings-panel-mcp-tab`、`repo-picker`、`schedule-panel` 和 `github-webhook-panel` 中重复出现的危险态界面/破坏性可操作元素迁移到了语义化 token 契约上。

## 解决方案

- 语义化危险态契约现已在 `src/app/globals.css` 和 `src/app/styles/desktop-theme.css` 中以共享的 `--danger-*` / `--dt-danger-*` 别名形式存在。
- 共享入口现在消费该契约，而不再使用原始色板类：
  - `src/client/components/button.tsx`
  - `src/client/components/color-system.ts`
  - `src/client/components/settings-panel-mcp-tab.tsx`
  - `src/client/components/repo-picker.tsx`
  - `src/client/components/schedule-panel.tsx`
  - `src/client/components/github-webhook-panel.tsx`
- Storybook 和治理文档已更新，使设计系统契约可见且与 lint 兼容：
  - `src/client/components/desktop-color-tokens.stories.tsx`
  - `scripts/lint-design-system-css.mjs`
  - `docs/fitness/design-system-quality-layers.md`
- 验证已完成：
  - `npm run lint:color-system:strict -- ...`
  - `npm run lint:css`
  - `npx eslint ...`
  - `npx vitest run src/client/components/__tests__/button.test.tsx`
  - `entrix run --tier normal`


## 参考

- `src/app/globals.css`
- `src/app/styles/desktop-theme.css`
- `docs/fitness/design-system-quality-layers.md`
