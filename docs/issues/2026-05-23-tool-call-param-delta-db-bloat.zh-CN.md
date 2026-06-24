---
title: "ACP tool_call_params_delta 持久化可能导致 SQLite 数据库膨胀"
date: "2026-05-23"
status: resolved
severity: high
area: "storage"
tags: ["sqlite", "acp", "retention", "tool-call-streaming"]
reported_by: "local-operations"
---

# ACP tool_call_params_delta 持久化可能导致 SQLite 数据库膨胀

## 摘要

大型 ACP 工具输入会以大量 `tool_call_params_delta` 更新的形式进行流式传输。Routa
为每一个中间 delta 都持久化了重复的 `accumulatedJson` 和 `parsedInput` 快照，因此像 Kanban
`update_card` 这样的大型工具在长时间的 Agent 会话中会成倍放大数据库体积。

## 影响

- `session_messages` 可能在 SQLite 数据库体积中占据主导地位。
- `tool_call_params_delta` 行远大于助手文本块。
- 清理工作需要先进行 JSON 压缩，随后再执行 SQLite `VACUUM` 才能在物理上缩小
  数据库文件。

## 解决方案

- 在持久化落盘之前压缩 `tool_call_params_delta` 通知。
- 为实时 UI 消费者保留活动会话的内存流式行为。
- 新增一个维护工具，用于对现有的 `session_messages` 和
  `acp_sessions.message_history` 行执行 dry-run/apply 清理。
- 在
  `docs/operational/runbooks/tool-call-param-delta-compaction.md` 中记录运维侧的清理路径。
