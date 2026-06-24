---
title: "积压细化仅写评论时，规范契约门禁可能陷入循环"
date: "2026-05-22"
kind: issue
status: open
severity: medium
area: "kanban"
tags: ["canonical-contract", "backlog", "prompts", "kanban"]
github_issue: null
github_state: null
github_url: null
created_at: 2026-05-22
updated_at: 2026-05-22
---

## 发生了什么

一张 QuantDinger 工作流卡片反复未能通过规范故事契约门禁（canonical story contract gate），报出
"Canonical story YAML is missing" 错误。

该卡片的积压细化（backlog refinement）笔记声称故事已经过细化，但持久化的任务
`objective` 中仍然只包含一句简短的散文式句子。规范 YAML 并未回写到
卡片的描述/objective 中，因此当 Agent 在仅更新评论的循环中反复尝试时，门禁正确地拒绝了该转换。

## 为何重要

契约门禁的目的是在下游泳道开始工作之前，拦截格式错误的积压故事。
如果提示词允许 Agent 把评论或完成笔记当作细化证据，Routa 可能会
产生一种虚假的进展感，并在不改动受门禁约束字段的情况下不断消耗泳道尝试次数。

## 修复方向

- 保持规范契约门禁的严格性。
- 让积压/受契约门禁约束的提示词明确说明：YAML 必须通过 `update_card` 持久化到
  卡片描述中。
- 声明评论、进度笔记和完成摘要不满足契约门禁。
- 添加提示词回归测试，使未来的提示词改动不会移除这条指令。
