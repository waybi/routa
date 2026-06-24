---
title: "ACP 权限请求卡片把丰富的请求载荷折叠成了通用 UI"
date: "2026-04-08"
status: resolved
severity: medium
area: ui
tags: ["acp", "ui", "permission", "codex", "chat"]
reported_by: "Codex"
related_issues: ["https://github.com/phodal/routa/issues/401"]
github_issue: 401
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/401"
resolved_at: "2026-04-08"
---

# ACP 权限请求卡片把丰富的请求载荷折叠成了通用 UI

## 发生了什么

聊天 UI 把 ACP 的 `request-permissions` 工具调用渲染成了一个通用的 `请求权限` 卡片，即使载荷中本已包含更丰富的嵌套结构：

- `toolCall.title` 包含具体的命令摘要
- `toolCall.rawInput.reason` 包含实际的审批提示语
- `options[]` 包含明确的允许一次 / 始终允许 / 拒绝标签

因此该卡片隐藏了真正被审批的操作，并显示了通用控件，而不是 Adapter 发来的选项标签。

## 预期行为

- 将嵌套的 `toolCall.title` 作为主要的权限请求标题展示
- 将嵌套的 `toolCall.rawInput.reason` 作为审批原因展示
- 从 `options[]` 渲染操作标签，而不是通用的保存/取消文案
- 保持与旧的顶层 `permissions` 载荷形态的兼容性

## 复现载荷形态

观察到的等待中工具调用载荷：

```json
{
  "toolKind": "request-permissions",
  "toolRawInput": {
    "toolCall": {
      "title": "Run gh api repos/phodal/routa/pulls?head=phodal:issue/670c06ff&state=open",
      "rawInput": {
        "reason": "Do you want to allow checking GitHub for an existing PR so I don’t create a duplicate?",
        "proposed_execpolicy_amendment": ["gh", "api"]
      }
    },
    "options": [
      { "optionId": "approved-for-session", "name": "Always" },
      { "optionId": "approved", "name": "Yes" },
      { "optionId": "abort", "name": "No, provide feedback" }
    ]
  }
}
```

## 为什么会发生

`PermissionRequestBubble` 只查找旧的顶层字段，例如：

- `rawInput.reason`
- `rawInput.permissions`

它没有解读 ACP 标准的嵌套 `toolCall` 和 `options` 字段，所以 UI 退回到了通用的权限卡片。
