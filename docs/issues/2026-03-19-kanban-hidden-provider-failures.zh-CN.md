---
title: "看板卡片覆盖配置可能掩盖 ACP Provider 运行时故障"
date: "2026-03-19"
status: resolved
resolved_at: "2026-03-19"
severity: high
area: "kanban"
tags: [kanban, acp, provider, runtime-error, ui, automation]
reported_by: "Codex"
github_issue: 201
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/201"
related_issues: [
  "docs/issues/2026-03-11-card-detail-rerun-mechanism-issues.md",
  "docs/issues/2026-03-17-dev-acp-session-watchdog-auto-recovery.md",
  "https://github.com/phodal/routa/issues/201"
]
---

# 看板卡片覆盖配置可能掩盖 ACP Provider 运行时故障

## 发生了什么

在看板卡片详情浮层中，用户可以在 `Card Session Override` 中选择不同的 ACP Provider 并手动重跑该卡片。当所选 Provider 在运行时失败时，即使底层 ACP 会话已上报错误，该故障也未能在看板 UI 中清晰呈现。

该流程中观察到的行为：

1. 打开某个看板卡片详情面板并展开 `Card Session Override`。
2. 选择一个 Provider，例如 `Auggie`，然后重跑该卡片。
3. 右侧会话面板显示 Provider 的 stderr，并报出 ACP/运行时错误，例如 `Permission denied: HTTP error: 403 Forbidden`。
4. 左侧 `Execution` 面板看起来基本正常，没有明确的 Provider 故障横幅或可执行的指引。
5. Provider 选择器本身也没有提示所选 Provider 存在风险、不可用或近期发生过故障。

## 预期行为

- 如果所选 ACP Provider 在会话启动或 prompt 执行期间失败，看板卡片详情 UI 应在 `Execution` 面板中清晰展示该故障。
- 用户应当能够在不打开 stderr 或 Trace 详情的情况下，理解是哪个 Provider 失败、为何失败以及下一步该怎么做。
- 看板 Provider 选择器应以与主 ACP 输入体验一致的方式反映 Provider 的健康状态/状态。
- 看板工作流自动化不应将 JSON-RPC 或流式 ACP 错误视为一次成功的运行。

## 复现上下文

- 环境：Web 端
- 触发条件：选择一个看板卡片覆盖 Provider，并使用一个能够启动但会在 prompt 执行或授权阶段失败的 Provider 来运行卡片

## 可能的原因

- 看板覆盖 Provider 选择器似乎使用了一个扁平化的可用 Provider 列表，没有暴露 Provider 的健康元数据或不可用原因。
- 看板自动化的 prompt 路径可能依赖 HTTP 是否成功，而没有检查 JSON-RPC 错误负载或流式错误事件。
- 标准 ACP Provider 错误通知可能没有被一致地归一化为语义化的故障事件。
- 卡片详情的执行 UI 当前可能未渲染 `acpError` 或 `lastSyncError`，即便这些字段在会话/任务模型的其他位置已可用。

## 相关文件

- `src/core/kanban/agent-trigger.ts`
- `src/core/kanban/workflow-orchestrator-singleton.ts`
- `src/app/api/acp/route.ts`
- `src/core/acp/provider-adapter/standard-acp-adapter.ts`
- `src/core/acp/agent-event-bridge/agent-event-bridge.ts`
- `src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx`
- `src/app/api/providers/route.ts`

## 观察记录

- 用户提供的截图显示，一个看板卡片在覆盖状态下选中了 `Auggie · DEVELOPER · None`，而会话面板的 stderr 报出 `HTTP error: 403 Forbidden`。
- 同一个看板界面目前没有在执行面板中提供清晰的内联错误横幅。
- 主 ACP 输入已经具备比看板覆盖选择器更丰富的 Provider 状态 UI。
- 本地验证截图保存在 `/tmp/kanban-provider-failure/kanban-auggie-failure.png`。

## 参考资料

- 来自 2026-03-19 看板调试会话的用户报告与截图
- GitHub issue：https://github.com/phodal/routa/issues/201

## 解决方案

该问题已在当前代码库中解决，对应的上游 GitHub issue 也已关闭。

当前实现中的证据：

- `src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx` 现在会通过
  `getPromptFailureMessage(...)` 从 `sessionInfo.acpError` 或 `task.lastSyncError`
  推导出故障信息。
- 同一执行面板会渲染明确的故障横幅：
  `Current run failed on ...`，并附带针对 ACP 或
  A2A 重跑的可执行后续步骤。
- `src/app/api/acp/acp-session-prompt.ts` 通过将会话 ACP 状态更新为
  `error` 来标记 prompt 失败，而 `src/core/acp/prompt-response.ts` 会从流式错误
  封装中提取明确的 SSE 错误信息。
- `src/app/workspace/[workspaceId]/kanban/__tests__/kanban-tab.test.tsx`
  包含一个聚焦的回归测试
  `surfaces provider runtime failures in the execution panel`，用于验证
  Provider 故障横幅会连同 ACP 错误信息一起渲染。
