---
title: Harness Trace 学习指南
---

# Harness Trace 学习 - 用户指南

> **从经验中学习，更快地演进**：一份使用 Harness Evolution 自学习能力的实用指南。

## 快速开始

### 1. 生成演进历史

多次运行 harness evolution 以积累学习数据：

```bash
# Option A: Bootstrap mode (new repositories)
routa harness evolve --bootstrap --apply

# Option B: Regular evolution (existing harness)
routa harness evolve --apply
```

每次运行都会向 `docs/fitness/evolution/history.jsonl` 追加一条详细记录。

### 2. 生成 Playbook

在 3 次以上具有相似缺口（gap）模式的成功运行之后：

```bash
routa harness evolve --learn
```

**预期输出**：
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

### 3. 自动使用 Playbook

在后续运行中，Playbook 会被自动加载：

```bash
routa harness evolve --apply
```

**加载了 Playbook 时**：
```
🧠 Loaded learned playbook (confidence: 95%, exact match)
  ID: harness-evolution-missing-governance
  Evidence: 3 successful runs

💡 Recommended patch order:
  1. patch.create_codeowners
  2. patch.create_dependabot

📊 Harness Evolution - Evaluation
  Found 2 gaps...
  Generated 2 patches (reordered by playbook)...
  
✅ Applied 2 patches
```

## 理解演进历史

### 记录的内容

每一次 `routa harness evolve --apply` 运行都会记录：

```json
{
  "timestamp": "2026-04-06T01:29:43Z",
  "sessionId": null,
  "taskType": "harness_evolution",
  "workflow": "bootstrap",
  "trigger": "manual",
  "gapsDetected": 2,
  "gapCategories": ["missing_governance_gate", "missing_execution_surface"],
  "changedPaths": [".github/CODEOWNERS", "docs/harness/build.yml"],
  "patchesApplied": ["patch.create_codeowners", "bootstrap.synthesize_build_yml"],
  "patchesFailed": [],
  "successRate": 1.0,
  "rollbackReason": null,
  "errorMessages": null
}
```

### 关键字段

- **`gapCategories`**：检测到了哪些缺口（用于模式匹配）
- **`patchesApplied`**：哪些补丁成功应用（用于学习补丁顺序）
- **`successRate`**：1.0 = 所有补丁均成功，0.0 = 全部失败
- **`workflow`**："bootstrap" | "auto-apply" | "evaluation"

### 存储

- **路径**：`docs/fitness/evolution/history.jsonl`
- **格式**：JSONL（每行一个 JSON 对象）
- **是否提交**：是（建议纳入版本管理以追踪长期演进）

## 理解 Playbook

### Playbook 结构

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

### 关键概念

**Strategy（策略）**：
- `preferredPatchOrder`：按此顺序应用补丁（从成功运行中学习得到）
- `gapPatterns`：当检测到这些缺口类别时应用此 Playbook
- `antiPatterns`：应避免的做法（从失败运行中学习得到）

**Provenance（来源追溯）**：
- `sourceRuns`：此 Playbook 学习所依据的运行时间戳
- `successRate`：源运行的平均成功率
- `evidenceCount`：贡献于此 Playbook 的运行次数

### 存储

- **路径**：`docs/fitness/playbooks/*.json`
- **格式**：JSON（每个 Playbook 一个文件）
- **是否提交**：建议提交（可在团队间共享知识）

## Playbook 匹配

### 精确匹配（优先）

Playbook 的缺口模式与当前缺口**完全一致**：

```
Playbook:  ["missing_governance_gate", "missing_execution_surface"]
Current:   ["missing_governance_gate", "missing_execution_surface"]
Result:    Exact match ✓
```

### 模糊匹配（回退方案）

Playbook 与当前缺口的**重叠度 >= 50%**：

```
Playbook:  ["missing_governance_gate", "missing_execution_surface"]
Current:   ["missing_governance_gate", "missing_execution_surface", "missing_automation"]
Overlap:   2/3 = 66% >= 50% ✓
Result:    Partial match ✓
```

### 无匹配

重叠度**< 50%**：

```
Playbook:  ["missing_governance_gate"]
Current:   ["missing_execution_surface", "missing_automation", "missing_boundary"]
Overlap:   0/3 = 0% < 50% ✗
Result:    No match ✗
```

### 选择算法

1. 首先尝试精确匹配
2. 若无精确匹配，则计算所有 Playbook 的重叠度
3. 筛选出重叠度 >= 50% 的候选项
4. 选择 `weighted_score = overlap_ratio * confidence` 最高的一个
5. 若无候选项，则不使用 Playbook 继续执行

## 常见工作流

### 工作流 1：为多个仓库执行 Bootstrap

**场景**：你要为 5 个相似的仓库设置 harness。

```bash
# Repository 1: Bootstrap and generate initial playbook
cd repo1
routa harness evolve --bootstrap --apply
cd ..

# Repository 2-3: Accumulate more data
cd repo2 && routa harness evolve --bootstrap --apply && cd ..
cd repo3 && routa harness evolve --bootstrap --apply && cd ..

# Generate playbook from 3 runs
cd repo1
routa harness evolve --learn
# ✓ harness-evolution-missing-execution-surface.json generated

# Copy playbook to other repos (or commit to shared location)
cp docs/fitness/playbooks/*.json ../repo4/docs/fitness/playbooks/
cp docs/fitness/playbooks/*.json ../repo5/docs/fitness/playbooks/

# Repository 4-5: Benefit from learned strategy
cd ../repo4 && routa harness evolve --bootstrap --apply
# 🧠 Loaded learned playbook (confidence: 100%, exact match)
# 💡 Recommended patch order: ...
```

### 工作流 2：持续改进

**场景**：在日常 harness 维护中结合学习能力。

```bash
# Week 1: Initial run
routa harness evolve --apply
# Recorded to history.jsonl (1 entry)

# Week 2: Another run
routa harness evolve --apply
# Recorded to history.jsonl (2 entries)

# Week 3: Third run
routa harness evolve --apply
# Recorded to history.jsonl (3 entries)

# Week 3: Generate playbook
routa harness evolve --learn
# ✓ Playbook generated from 3 successful runs

# Week 4+: Use learned strategy
routa harness evolve --apply
# 🧠 Loaded learned playbook (automatic)
```

### 工作流 3：审查与优化

**场景**：在使用之前审查生成的 Playbook。

```bash
# Generate playbooks
routa harness evolve --learn

# Review playbooks
cat docs/fitness/playbooks/*.json | jq

# Check provenance (which runs contributed?)
jq '.provenance.sourceRuns' docs/fitness/playbooks/*.json

# Check confidence
jq '.confidence' docs/fitness/playbooks/*.json

# If playbook looks good, commit it
git add docs/fitness/playbooks/
git commit -m "Add learned playbook for missing_governance pattern"

# If playbook needs adjustment, edit manually or delete
rm docs/fitness/playbooks/low-confidence-playbook.json
```

## 进阶主题

### 手动编辑 Playbook

Playbook 是 JSON 文件，可以手动编辑：

```bash
# Edit playbook
vim docs/fitness/playbooks/harness-evolution-missing-governance.json

# Add custom anti-pattern
{
  "doNot": "apply patches without testing",
  "reason": "Team policy: always run tests first"
}

# Adjust patch order
"preferredPatchOrder": [
  "patch.create_tests",      // Custom: tests first
  "patch.create_codeowners",
  "patch.create_dependabot"
]
```

### Playbook 版本管理

用 Git 追踪 Playbook 的演进：

```bash
# View playbook history
git log -p docs/fitness/playbooks/harness-evolution-*.json

# Compare playbook versions
git diff HEAD~1 docs/fitness/playbooks/harness-evolution-missing-governance.json

# Restore previous playbook version
git checkout HEAD~1 -- docs/fitness/playbooks/harness-evolution-missing-governance.json
```

### 跨仓库共享

**Option A：Git 子模块**（用于集中式 Playbook）

```bash
# In central repo
mkdir playbooks-shared
mv docs/fitness/playbooks/*.json playbooks-shared/
git add playbooks-shared && git commit -m "Centralize playbooks"

# In other repos
git submodule add <central-repo-url> .playbooks-shared
ln -s .playbooks-shared docs/fitness/playbooks
```

**Option B：手动同步**（更简单）

```bash
# Copy playbooks to other repos
scp docs/fitness/playbooks/*.json user@server:/repos/repo2/docs/fitness/playbooks/
```

### 调试

**Playbook 未加载？**

```bash
# Check if playbook file exists
ls -la docs/fitness/playbooks/

# Validate JSON syntax
jq . docs/fitness/playbooks/*.json

# Check playbook task type
jq '.taskType' docs/fitness/playbooks/*.json
# Should be "harness_evolution"
```

**Playbook 未匹配？**

```bash
# See current gaps
routa harness evolve --dry-run --format json | jq '.gaps[].category'

# See playbook gap patterns
jq '.strategy.gapPatterns' docs/fitness/playbooks/*.json

# Check overlap
# Current: ["gap_a", "gap_b", "gap_c"]
# Playbook: ["gap_a", "gap_b"]
# Overlap: 2/3 = 66% (should match)
```

**为什么没有生成 Playbook？**

```bash
# Check history entries
wc -l docs/fitness/evolution/history.jsonl
# Need at least 3 entries

# Check success rate
jq '.successRate' docs/fitness/evolution/history.jsonl
# Need >= 0.8 (80%)

# Check gap patterns
jq '.gapCategories' docs/fitness/evolution/history.jsonl
# Need 3+ runs with same pattern
```

## 最佳实践

### 1. 提交演进历史

```bash
git add docs/fitness/evolution/history.jsonl
git commit -m "Update evolution history"
```

**原因**：团队成员可以从集体学习中受益。

### 2. 提交前审查 Playbook

```bash
# Generate playbook
routa harness evolve --learn

# Review before committing
cat docs/fitness/playbooks/*.json | jq

# Commit only high-confidence playbooks
jq 'select(.confidence >= 0.9)' docs/fitness/playbooks/*.json
```

**原因**：避免传播低质量的策略。

### 3. 定期清理 Playbook

```bash
# Find old playbooks (adjust date as needed)
find docs/fitness/playbooks/ -name "*.json" -mtime +90

# Review and delete stale playbooks
rm docs/fitness/playbooks/old-playbook.json
```

**原因**：让 Playbook 与当前代码库状态保持相关。

### 4. 记录 Playbook 决策

在提交信息中添加说明：

```bash
git commit -m "Add playbook for governance gaps

This playbook was generated from 5 successful runs across 3 repos.
It consistently applies CODEOWNERS before dependabot, which reduces
merge conflicts.

Evidence: 5/5 runs successful with this order.
"
```

## 故障排查

### 问题：Playbook 始终显示 "partial match"

**原因**：当前缺口与 Playbook 模式不同。

**解决方案**：
1. 检查当前运行中确切的缺口类别
2. 在更多采用当前模式的运行之后重新生成 Playbook
3. 或调整模糊匹配阈值（需要改动代码）

### 问题：应用了错误的补丁顺序

**原因**：多个 Playbook 都匹配，选中了错误的那个。

**解决方案**：
1. 检查所有匹配的 Playbook：`ls docs/fitness/playbooks/`
2. 审查置信度分数：`jq '.confidence' docs/fitness/playbooks/*.json`
3. 删除置信度较低的 Playbook，或手动调整置信度

### 问题：Playbook 没有改善性能

**原因**：所学策略对当前仓库状态可能并非最优。

**解决方案**：
1. 删除该 Playbook：`rm docs/fitness/playbooks/playbook-name.json`
2. 让系统从全新的运行中重新学习
3. 或手动编辑 Playbook 以调整策略

## 相关文档

- [Harness Trace 学习 - 功能概览](../features/harness-trace-learning.md)
- [Harness Trace 学习 - 第二阶段设计](../design-docs/harness-trace-learning-phase2.md)
- [适应度函数规则手册](https://github.com/phodal/routa/blob/main/docs/fitness/README.md)
- [Harness 适应度函数博客](/blog/harness-fitness-function)

## 反馈

发现了 bug 或有功能需求？

- [提交 issue](https://github.com/phodal/routa/issues/new)
- 相关：Issue [#294](https://github.com/phodal/routa/issues/294)
