---
title: Harness Trace 学习
---

# Harness 演进 Trace 学习

> **自我改进的 Harness 演进**：从历史运行中学习，生成有证据支撑的 playbook，并加速未来的演进。

## 概述

Harness 演进的 **Trace 学习**功能让系统能够从自身的执行历史中学习，自动检测成功运行中的模式，并将其提炼为可复用的 playbook。这构建了一个自我改进的闭环——每一次 Harness 演进运行都让下一次更聪明。

## 核心概念

### 演进历史

每一次 `routa harness evolve --apply` 运行都会将丰富的执行上下文记录到 `docs/fitness/evolution/history.jsonl`：

```json
{
  "timestamp": "2026-04-06T01:29:43Z",
  "sessionId": "abc-123",                    // Links to agent traces
  "taskType": "harness_evolution",
  "workflow": "bootstrap",                   // Auto-inferred
  "trigger": "manual",
  "gapsDetected": 2,
  "gapCategories": ["missing_governance_gate", "missing_execution_surface"],
  "changedPaths": [".github/CODEOWNERS", "docs/harness/build.yml"],
  "patchesApplied": ["patch.create_codeowners", "bootstrap.synthesize_build_yml"],
  "patchesFailed": [],
  "successRate": 1.0
}
```

### 模式检测

学习算法会分析历史运行，找出反复出现的模式：

1. **按 gap 模式分组** —— 哪些 gap 类别会一起出现？
2. **筛选成功运行** —— success_rate ≥ 80%
3. **寻找共识** —— 出现 3 次及以上的模式
4. **提取策略** —— 偏好的补丁顺序、常见的文件变更

### Playbook

生成的 playbook 会捕获经过验证的策略，并附带完整的来源信息：

```json
{
  "id": "harness-evolution-missing-governance",
  "taskType": "harness_evolution",
  "confidence": 0.95,
  "strategy": {
    "preferredPatchOrder": [
      "patch.create_codeowners",
      "patch.create_dependabot"
    ],
    "gapPatterns": ["missing_governance_gate"],
    "antiPatterns": [
      {
        "doNot": "skip ratchet enforcement",
        "reason": "Caused fitness regression in 2/5 runs"
      }
    ]
  },
  "provenance": {
    "sourceRuns": [
      "2026-04-06T01:29:43Z",
      "2026-04-06T02:15:22Z",
      "2026-04-07T10:30:15Z"
    ],
    "successRate": 0.95,
    "evidenceCount": 3
  }
}
```

## 用法

### 阶段 1：生成演进历史

多次运行 Harness 演进以构建学习数据集：

```bash
# Bootstrap multiple repos
for repo in repo1 repo2 repo3; do
  cd $repo
  routa harness evolve --bootstrap --apply
done

# Or run on the same repo after making changes
routa harness evolve --apply
```

每次运行都会追加内容到 `docs/fitness/evolution/history.jsonl`。

### 阶段 2：从历史中学习

在出现 3 次以上具有相似 gap 模式的成功运行之后：

```bash
routa harness evolve --learn
```

**输出**：
```
📊 Harness Evolution - Learning Mode
  Loading evolution history...
  Found 5 evolution runs
  Detected 2 common patterns:
    - Gap pattern: ["missing_governance_gate"] (seen 3 times, avg success: 100.0%)
    - Gap pattern: ["missing_execution_surface"] (seen 4 times, avg success: 95.0%)
  Generated 2 playbook candidates:
    ✓ harness-evolution-missing-governance.json (confidence: 100.0%, evidence: 3 runs)
    ✓ harness-evolution-missing-execution-surface.json (confidence: 95.0%, evidence: 4 runs)

✅ Playbooks saved to docs/fitness/playbooks
```

### 阶段 3：审阅 Playbook

检查生成的 playbook：

```bash
# List all playbooks
ls docs/fitness/playbooks/

# View a playbook
cat docs/fitness/playbooks/harness-evolution-missing-governance.json | jq

# Check patch order
jq '.strategy.preferredPatchOrder' docs/fitness/playbooks/*.json
```

### 阶段 4：运行时集成（将在阶段 2 推出）

未来版本将在运行时自动加载 playbook：

```bash
routa harness evolve --apply

# 🧠 Loaded 1 learned playbook (confidence: 95%)
#   Recommended patch order: ["patch.A", "patch.B"]
#   Evidence: 3 successful runs over 2 weeks
```

## 收益

### 1. 自我改进闭环

```
Run → Evidence → Playbook → Runtime → Guardrail
```

每一次演进运行都让系统在下一次更聪明。

### 2. 有证据支撑的策略

每个 playbook 都会回链到带有时间戳的具体运行，确保策略是由真实执行验证的，而非凭直觉得出。

### 3. 跨项目知识迁移

从某个仓库生成的 playbook 可以为相似仓库的演进提供参考，从而加速 bootstrap。

### 4. 持续打磨

随着更多运行的累积，置信度分数会上升、反模式会浮现，使 playbook 随时间推移变得更加可靠。

## 存储

### 演进历史
- **路径**：`docs/fitness/evolution/history.jsonl`
- **格式**：JSONL（仅追加）
- **是否提交**：是（属于仓库历史的一部分）

### Playbook
- **路径**：`docs/fitness/playbooks/*.json`
- **格式**：JSON
- **是否提交**：推荐（可共享的知识）

## 与 Agent Trace 的集成

演进历史条目中包含 `sessionId`，用于关联 `.routa/traces/` 中完整的 Agent 执行 Trace，从而支持深入分析：

- 在 gap 检测过程中读取了哪些文件？
- 确切的工具调用序列是什么？
- 前后的 Git 状态分别是什么？

后续设计与运营方向详见 [Harness Trace 学习 —— 阶段 2 设计](../design-docs/harness-trace-learning-phase2.md)。

## 路线图

- **阶段 0**（✅ 已完成）：为 Trace 学习扩展 schema
- **阶段 1**（✅ 已完成）：模式检测 + playbook 生成
- **阶段 2**（⏭️ 下一步）：运行时 playbook 加载 + 预检指导
- **阶段 3**（未来）：Guardrail 晋升 + 跨仓库共享

## 相关链接

- [适应度函数规则手册](https://github.com/phodal/routa/blob/main/docs/fitness/README.md)
- [Harness Fitness 博客](/blog/harness-fitness-function)
- [架构](../ARCHITECTURE.md)
- Issue [#294](https://github.com/phodal/routa/issues/294) —— Trace 学习
- PR [#342](https://github.com/phodal/routa/pull/342) —— 设计 RFC
- PR [#343](https://github.com/phodal/routa/pull/343) —— 阶段 0
- PR [#345](https://github.com/phodal/routa/pull/345) —— 阶段 1
