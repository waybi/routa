---
title: "实时画布入口在 composer 断开连接时无法提供可用的下一步操作"
date: "2026-04-27"
kind: issue
status: resolved
severity: medium
area: "ui"
tags: ["canvas", "session", "ux", "dogfood"]
reported_by: "codex"
related_issues: ["https://github.com/phodal/routa/pull/536"]
github_issue: 537
github_state: closed
github_url: "https://github.com/phodal/routa/issues/537"
---

# 实时画布入口在 composer 断开连接时无法提供可用的下一步操作

## 发生了什么

在对实时会话画布入口进行本地 dogfood 测试时，会话页面在聊天 composer 处于断开连接状态下仍显示了一个可点击的 `Use Canvas` 操作。

点击 `Use Canvas` 后，操作标签变为 `Canvas`，但 composer 仍然为空，并继续显示禁用状态下的 `Connect first...` 占位文本。没有出现任何生成的画布提示词、toast、内联消息、禁用状态或恢复指引。

## 预期行为

画布入口不应让用户陷入死胡同状态。它应当满足以下任一情形：

- 在 composer 能够接受并发送生成的画布提示词之前，保持禁用状态。
- 或者明确提示用户：必须先选择/连接一个 Provider，才能启动画布模式。

## 复现上下文

- 环境：web
- URL：`http://localhost:3000/workspace/default/sessions/session-1`
- 分支：`feat/live-canvas-session-entry`
- 触发条件：在 composer 显示 `Connect first...` 时点击 `Use Canvas`

步骤：

1. 使用 `npm run dev -- --port 3000` 启动本地 Next.js 开发服务器。
2. 打开 `/workspace/default/sessions/session-1`。
3. 确认 composer 显示 `Connect first...`。
4. 点击 `Use Canvas`。
5. 观察到按钮标签变为 `Canvas`，但 composer 仍为空且没有任何指引出现。

## 可能的原因

- 画布预填充状态可能在断开连接状态下被设置，而此时 composer 拒绝或隐藏预填充文本。
- 画布入口很可能没有与聊天 composer 的发送路径共享同一套可用性/禁用契约。
- 点击后的 UI 状态可能仅指示进入了画布模式，却没有验证用户是否真的能够继续操作。

## 相关文件

- `src/app/workspace/[workspaceId]/sessions/[sessionId]/session-page-client.tsx`
- `src/client/components/session-canvas-panel.tsx`
- `src/core/canvas/session-canvas-prompt.ts`

## 观察记录

- Dogfood 报告：`docs/issues/assets/2026-04-27-live-canvas-entry/report.md`
- 复现视频：`docs/issues/assets/2026-04-27-live-canvas-entry/videos/canvas-entry-repro.webm`
- 初始截图：`docs/issues/assets/2026-04-27-live-canvas-entry/screenshots/initial-session.png`
- 结果截图：`docs/issues/assets/2026-04-27-live-canvas-entry/screenshots/canvas-entry-result.png`
- 复现过程中浏览器控制台未出现运行时错误。
- 已于 2026-04-28 解决：在 ACP 断开连接时禁用画布操作，并在该操作启用时预填充一条本地化的默认画布请求。
- 验证：定向 Vitest、`npx tsc --noEmit`、定向 ESLint、在 `http://localhost:3000/workspace/default/sessions/session-1` 上的浏览器冒烟测试，以及 `entrix run --tier fast`。

## 参考

- PR：https://github.com/phodal/routa/pull/536
- GitHub issue：https://github.com/phodal/routa/issues/537
