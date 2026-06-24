---
title: "规范化 story YAML 需要一个契约门禁来阻止 backlog/todo 反复弹跳的循环"
date: "2026-04-08"
status: resolved
severity: high
area: "kanban"
tags: ["kanban", "yaml", "contract", "automation", "loop-prevention"]
reported_by: "agent"
related_issues: []
resolved_at: "2026-04-28"
resolution: "规范化 story 契约规则与循环阻断器（loop-breaker）的强制执行已在任务转换以及卡片描述更新路径中落地。"
---

# 规范化 Story YAML 契约门禁循环

## 发生了什么

当规范化 story YAML 格式不正确时，看板卡片会在 `backlog` 与 `todo` 之间来回弹跳。

- Backlog 阶段的需求细化（refinement）产出了一个 YAML 契约块，它在结构上看起来接近有效的 YAML，但无法被干净地解析。
- Todo 阶段的编排或下游检查拒绝了这个格式错误的契约，并把卡片打回 Backlog。
- 系统有交付门禁（delivery gates）和通用的非开发循环上限，但在 `update_card` 以及 `backlog -> todo` 转换上没有专门的规范化契约门禁。
- 这导致同一份格式错误的 YAML 被反复重试，并在看板历史中产生明显的抖动。

## 为什么重要

- 规范化 story 契约是下游 INVEST / readiness 检查的事实来源（source of truth）。如果它格式不正确，Todo 就无法安全地将该 story 视为可执行就绪。
- Backlog/Todo 之间的反复弹跳会产生嘈杂的评论、浪费自动化运行次数，并掩盖真正的修复路径。
- 除非将契约门禁集中化，否则不同的变更路径（`update_card`、REST task PATCH、`move_card`）在行为上可能会出现分歧。

## 设计方向

保留 YAML 作为规范化的 story 格式，但更早、更统一地强制执行它。

- 在看板自动化配置中，在现有的 `deliveryRules` 旁边新增列级别的 `contractRules`。
- 默认让 `todo` 要求一份有效的规范化 story YAML 契约。
- 当当前或下一次转换依赖该契约时，在描述更新时校验规范化 YAML。
- 在 `move_card` / 任务列转换时再次校验规范化 YAML。
- 为契约门禁失败记录系统备注，并在反复失败后触发循环阻断器（loop breaker），从而在 YAML 于 Backlog 中重新生成之前停止自动重试。

## 预期结果

- 格式错误的规范化 YAML 会在 Todo 能够开始执行工作之前被拦截。
- 所有变更路径共享相同的契约门禁语义。
- 在反复出现规范化契约失败后，卡片不再在 Backlog 与 Todo 之间来回振荡。

## Issue 卫生

- 2026-04-28：在确认看板任务路径中已存在 `contractRules`、`buildTaskContractReadiness`、转换/更新阻断、循环阻断器消息以及 route/tool 测试后，标记为已解决。
