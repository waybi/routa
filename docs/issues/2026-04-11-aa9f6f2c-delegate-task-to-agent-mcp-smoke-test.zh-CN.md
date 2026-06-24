---
title: "delegate_task_to_agent MCP 工具的冒烟测试"
date: "2026-04-11"
kind: issue
status: resolved
resolved_at: "2026-04-21"
severity: medium
area: mcp-tools
tags: [smoke-test, delegate-task, mcp, crafter]
reported_by: kiro
github_issue: null
github_state: null
github_url: null
---

# delegate_task_to_agent MCP 工具的冒烟测试 —— 通过创建一个任务并将其委派给 CRAFTER Agent 来验证执行路径

## Scope

delegate_task_to_agent MCP 工具的冒烟测试 —— 通过创建一个任务并将其委派给 CRAFTER Agent 来验证执行路径

## Acceptance Criteria

1. 通过 /api/tasks 成功创建任务
2. delegate_task_to_agent 返回 success=true，并带有 taskId 和 agentId
3. 响应包含带有 specialist 类型的正确委派负载

## Verification Commands

```
cd crates/routa-server && cargo test api_mcp_tools_delegate_task_to_agent_contract -- --nocapture
```

## Test Cases

测试先创建一个任务，然后通过 delegate_task_to_agent 工具调用将其委派给 CRAFTER Agent

## Resolution Update (2026-04-21)

- 已验证 `crates/routa-server/tests/rust_api_end_to_end.rs::api_mcp_tools_delegate_task_to_agent_contract` 存在且通过。
- 该端到端契约覆盖了任务创建、`delegate_task_to_agent` 执行，以及被委派 specialist 会话的成功负载结构。
