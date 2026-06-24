---
title: Harness Trace 学习速查表
---

# Harness Trace 学习 - 快速参考

> Harness 演化自学习功能的**单页速查表**。

## 命令

```bash
# 运行 harness 演化（记录到历史）
routa harness evolve --apply

# 从历史生成 playbook（需要 3 次以上运行）
routa harness evolve --learn

# 试运行预览（不做任何更改）
routa harness evolve --dry-run
```

## 文件位置

```
repo/
├── docs/
│   └── fitness/
│       ├── evolution/
│       │   └── history.jsonl           # 演化历史（仅追加）
│       └── playbooks/
│           └── harness-evolution-*.json # 生成的 playbook
```

## 演化历史条目

```json
{
  "timestamp": "2026-04-06T01:29:43Z",
  "taskType": "harness_evolution",
  "workflow": "bootstrap",
  "gapsDetected": 2,
  "gapCategories": ["missing_governance_gate", "missing_execution_surface"],
  "changedPaths": [".github/CODEOWNERS", "docs/harness/build.yml"],
  "patchesApplied": ["patch.create_codeowners", "bootstrap.synthesize_build_yml"],
  "successRate": 1.0
}
```

**关键字段**：
- `gapCategories` - 用于模式匹配
- `patchesApplied` - 用于学习补丁顺序
- `successRate` - 1.0 = 成功，0.0 = 失败

## Playbook 结构

```json
{
  "id": "harness-evolution-missing-governance",
  "confidence": 0.95,
  "strategy": {
    "preferredPatchOrder": ["patch.A", "patch.B"],
    "gapPatterns": ["missing_governance_gate"],
    "antiPatterns": [{"doNot": "...", "reason": "..."}]
  },
  "provenance": {
    "sourceRuns": ["2026-04-06T01:29:43Z", ...],
    "evidenceCount": 3
  }
}
```

**关键字段**：
- `preferredPatchOrder` - 补丁将被重新排序以匹配此顺序
- `gapPatterns` - 当出现这些缺口时，playbook 即匹配
- `provenance.evidenceCount` - 生成该 playbook 的运行次数

## Playbook 匹配

| 匹配类型 | 条件 | 示例 |
|------------|-----------|---------|
| **精确** | 100% 缺口匹配 | Playbook：`[a,b]`，当前：`[a,b]` ✓ |
| **部分** | ≥50% 重叠 | Playbook：`[a,b]`，当前：`[a,b,c]` ✓ (66%) |
| **不匹配** | <50% 重叠 | Playbook：`[a]`，当前：`[b,c,d]` ✗ (0%) |

**选择规则**：最高 `weighted_score = overlap_ratio * confidence`

## 预检指引

**精确匹配**：
```
🧠 Loaded learned playbook (confidence: 95%, exact match)
  ID: harness-evolution-missing-governance
  Evidence: 3 successful runs

💡 Recommended patch order:
  1. patch.create_codeowners
  2. patch.create_dependabot
```

**部分匹配**：
```
🧠 Loaded learned playbook (confidence: 95%, partial match)
  ID: harness-evolution-missing-governance
  Evidence: 3 successful runs

💡 Recommended patch order:
  1. patch.create_codeowners
  2. patch.create_dependabot

⚠️  Known issues:
  - skip ratchet: Caused regression in 2/5 runs
```

## 阈值

| 参数 | 取值 | 含义 |
|-----------|-------|---------|
| 最低成功率 | 80% | 仅从成功的运行中学习 |
| 最少出现次数 | 3 | 需要 3 次以上运行才能识别出模式 |
| 最低重叠度 | 50% | 模糊匹配要求缺口重叠 ≥50% |

## 常见任务

### 查看演化历史
```bash
cat docs/fitness/evolution/history.jsonl | jq .
```

### 查看历史中所有缺口类别
```bash
jq '.gapCategories[]' docs/fitness/evolution/history.jsonl | sort -u
```

### 检查 playbook 置信度
```bash
jq '.confidence' docs/fitness/playbooks/*.json
```

### 查看 playbook 来源信息
```bash
jq '.provenance' docs/fitness/playbooks/*.json
```

### 删除低置信度 playbook
```bash
# 先检查置信度
jq 'select(.confidence < 0.8) | .id' docs/fitness/playbooks/*.json

# 如有需要再删除
rm docs/fitness/playbooks/low-confidence-playbook.json
```

### 手动编辑 playbook
```bash
vim docs/fitness/playbooks/harness-evolution-missing-governance.json

# 调整补丁顺序
"preferredPatchOrder": [
  "patch.custom_first",  // Your custom order
  "patch.create_codeowners",
  "patch.create_dependabot"
]
```

## 调试

### 为什么没有生成 playbook？

```bash
# 检查历史条目数量
wc -l docs/fitness/evolution/history.jsonl
# 需要：≥ 3 条

# 检查成功率
jq '.successRate' docs/fitness/evolution/history.jsonl
# 需要：≥ 0.8 (80%)

# 检查缺口模式
jq '.gapCategories' docs/fitness/evolution/history.jsonl | sort | uniq -c
# 需要：3 次以上运行具有相同模式
```

### 为什么 playbook 不匹配？

```bash
# 当前缺口
routa harness evolve --dry-run --format json | jq '.gaps[].category'

# Playbook 模式
jq '.strategy.gapPatterns' docs/fitness/playbooks/*.json

# 计算重叠度
# 若 <50%，playbook 将不匹配
```

### 为什么补丁顺序错误？

```bash
# 检查所有 playbook
ls docs/fitness/playbooks/

# 检查置信度分数
jq '{id, confidence}' docs/fitness/playbooks/*.json

# 检查匹配到了哪个 playbook
routa harness evolve --dry-run 2>&1 | grep "Loaded learned playbook"
```

## 最佳实践

✅ **应当**：
- 将 `history.jsonl` 提交到 Git（团队共享学习）
- 提交前审查 playbook
- 删除陈旧的 playbook（超过 90 天）
- 编辑 playbook 以补充团队知识

❌ **不应当**：
- 手动编辑 `history.jsonl`（仅追加）
- 提交低置信度的 playbook（<80%）
- 混用来自不同 harness 版本的 playbook

## 相关文档

- **用户指南**：[docs/guides/harness-trace-learning-guide.md](../guides/harness-trace-learning-guide.md)
- **功能概览**：[docs/features/harness-trace-learning.md](../features/harness-trace-learning.md)
- **Issue #294**：https://github.com/phodal/routa/issues/294
- **PR #345**：https://github.com/phodal/routa/pull/345
