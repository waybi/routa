# Dogfood 报告：Routa Live Canvas 入口

| Field | Value |
|-------|-------|
| **Date** | 2026-04-27 |
| **App URL** | http://localhost:3000/workspace/default/sessions/session-1 |
| **Session** | routa-live-canvas-qa |
| **Scope** | 实时会话 Canvas 入口与首次运行 UX |

## 摘要

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 0 |
| **Total** | **1** |

## 问题

### ISSUE-001：聊天断连时 Canvas 入口未给出可用的下一步操作

| Field | Value |
|-------|-------|
| **Severity** | medium |
| **Category** | ux |
| **URL** | http://localhost:3000/workspace/default/sessions/session-1 |
| **Repro Video** | videos/canvas-entry-repro.webm |

**描述**

即便聊天输入框尚未连接，`Use Canvas` 操作依然可见且可点击。点击后按钮标签变为 `Canvas`，但输入框仍为空，并且只显示禁用状态的 `Connect first...` 占位提示。没有任何 toast、内联提示、禁用状态或引导来说明 Canvas 提示词未能插入，或用户接下来应该做什么。

预期行为：要么在输入框能够接收所生成的提示词之前禁用 Canvas 入口，要么点击时给出可操作的引导，例如提示在进入 Canvas 模式前先选择/连接一个 Provider。

**复现步骤**

1. 进入会话页面。
   ![Step 1](screenshots/canvas-entry-step-1.png)

2. 点击 `Use Canvas`。
   ![Step 2](screenshots/canvas-entry-step-2-after-click.png)

3. **观察：** 操作变为 `Canvas`，但输入框仍为空并显示 `Connect first...`；没有出现任何 Canvas 提示词或反馈。
   ![Result](screenshots/canvas-entry-result.png)

**补充证据**

- 初始标注截图：`screenshots/initial-session.png`
- 复现后已检查控制台/错误。未报告任何运行时错误；仅出现 React DevTools 和 HMR 日志。
