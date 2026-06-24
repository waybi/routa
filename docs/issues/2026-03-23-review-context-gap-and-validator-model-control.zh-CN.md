---
title: "评审流水线缺少图上下文与按校验器粒度的模型控制"
date: "2026-03-23"
status: resolved
severity: medium
area: "backend"
tags: ["review", "quality", "agent", "backend", "frontend-api"]
reported_by: "codex"
related_issues: ["https://github.com/phodal/routa/issues/227"]
github_issue: 227
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/227"
---

# 评审流水线缺少图上下文与按校验器粒度的模型控制

## 发生了什么

当前的评审分析流水线以 git diff 加上一小组配置片段作为主要的评审载荷。它并未包含 `entrix graph review-context` 中已经存在的、由图推导出的影响范围/测试半径评审上下文。

同一个模型覆盖被统一应用到所有评审 worker（`context`、`candidates`、`validator`）。无法只强制校验阶段使用特定的 Claude 模型，以进行有针对性的误报过滤测试。

## 为什么重要

- 仅依赖 diff 的上下文会削弱跨模块变更上的评审质量，并增加遗漏依赖的风险。
- 校验器质量是精确度收益最高的阶段。缺少按阶段的模型控制，就很难进行受控实验（例如，在保持前序阶段不变的同时让校验器跑在 Claude 上）。
- 缺失这些控制会拖慢质量迭代，并削弱对评审输出信噪比的信任。

## 解决说明

- 通过调用 `entrix graph review-context --base <base> --json`，在以下位置注入 `graphReviewContext` / `graph_review_context` 载荷：
  - Next.js 评审流水线
  - Rust 评审 API
  - Rust CLI 评审分析载荷构建器
- 新增按校验器粒度的模型覆盖支持：
  - Web API 请求字段：`validatorModel`
  - Rust API 请求字段：`validator_model`（camelCase JSON：`validatorModel`）
  - CLI 标志：`--validator-model`（其他 worker 共享 `--model` 作为回退）
- 已通过有针对性的测试和构建检查验证；GitHub issue #227 已关闭。
