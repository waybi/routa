---
title: Harness Trace 学习第 2 阶段
---

# Harness Trace 学习 - 第 2 阶段：运行时集成

**Status**: In Development  
**Created**: 2026-04-06  
**Related**: #294, #342, #343, #345

## 概述

第 2 阶段实现了**运行时 playbook 加载与预检（preflight）引导**，使 Harness 演进能够在执行过程中使用已学习到的策略。

## 目标

1. 在 Harness 演进启动时加载相关的 playbook
2. 向用户展示预检引导
3. 基于已学习的策略对补丁（patch）重新排序
4. 展示来源（provenance）以提升透明度

## 架构

### 1. Playbook 加载

**Function**: `load_playbooks_for_task(repo_root, task_type)`

```rust
pub fn load_playbooks_for_task(
    repo_root: &Path,
    task_type: &str,
) -> Result<Vec<PlaybookCandidate>, String> {
    let playbook_dir = repo_root.join("docs/fitness/playbooks");
    
    if !playbook_dir.exists() {
        return Ok(Vec::new());
    }
    
    // Read all .json files
    // Filter by task_type
    // Sort by confidence (descending)
    // Return top N (e.g., 3)
}
```

### 2. 缺口模式匹配

**Function**: `find_matching_playbook(playbooks, gaps)`

```rust
pub fn find_matching_playbook<'a>(
    playbooks: &'a [PlaybookCandidate],
    gaps: &[HarnessEngineeringGap],
) -> Option<&'a PlaybookCandidate> {
    // Extract gap categories from current run
    let current_categories: Vec<String> = gaps
        .iter()
        .map(|g| g.category.clone())
        .collect();
    
    // Find exact match
    playbooks.iter().find(|pb| {
        pb.strategy.gap_patterns == current_categories
    })
    
    // Or find best partial match
}
```

### 3. 预检引导展示

```rust
fn display_preflight_guidance(
    playbook: &PlaybookCandidate,
    options: &HarnessEngineeringOptions,
) {
    if options.json_output {
        return; // Skip in JSON mode
    }
    
    println!("🧠 Loaded learned playbook (confidence: {:.0}%)", playbook.confidence * 100.0);
    println!("  ID: {}", playbook.id);
    println!("  Evidence: {} successful runs", playbook.provenance.evidence_count);
    println!();
    println!("💡 Recommended patch order:");
    for (idx, patch_id) in playbook.strategy.preferred_patch_order.iter().enumerate() {
        println!("  {}. {}", idx + 1, patch_id);
    }
    
    if !playbook.strategy.anti_patterns.is_empty() {
        println!();
        println!("⚠️  Known issues:");
        for anti in &playbook.strategy.anti_patterns {
            println!("  - {}: {}", anti.do_not, anti.reason);
        }
    }
    
    println!();
}
```

### 4. 补丁重新排序

**Function**: `reorder_patches_by_playbook(patches, playbook)`

```rust
pub fn reorder_patches_by_playbook(
    patches: &mut Vec<HarnessEngineeringPatchCandidate>,
    playbook: &PlaybookCandidate,
) {
    // Create priority map from playbook order
    let priority_map: HashMap<String, usize> = playbook
        .strategy
        .preferred_patch_order
        .iter()
        .enumerate()
        .map(|(idx, id)| (id.clone(), idx))
        .collect();
    
    // Sort patches by:
    // 1. Patches in playbook order (by priority)
    // 2. Patches not in playbook (original order)
    patches.sort_by_key(|patch| {
        priority_map.get(&patch.id).copied().unwrap_or(usize::MAX)
    });
}
```

## 集成点

### 在 `evaluate_harness_engineering()` 中

```rust
pub async fn evaluate_harness_engineering(
    repo_root: &Path,
    options: &HarnessEngineeringOptions,
    state: Option<&AppState>,
) -> Result<HarnessEngineeringReport, String> {
    // ... existing gap detection ...
    
    // NEW: Load playbooks
    let playbooks = learning::load_playbooks_for_task(repo_root, "harness_evolution")?;
    
    // NEW: Find matching playbook
    let matching_playbook = playbooks
        .iter()
        .find(|pb| {
            let mut sorted_pattern = pb.strategy.gap_patterns.clone();
            sorted_pattern.sort();
            let mut current_categories: Vec<String> = gaps
                .iter()
                .map(|g| g.category.clone())
                .collect();
            current_categories.sort();
            sorted_pattern == current_categories
        });
    
    // ... existing patch generation ...
    
    // NEW: Reorder patches if playbook found
    if let Some(playbook) = matching_playbook {
        learning::display_preflight_guidance(playbook, options);
        learning::reorder_patches_by_playbook(&mut patch_candidates, playbook);
    }
    
    // ... rest of execution ...
}
```

## 用户体验

### 之前（第 1 阶段）

```bash
$ routa harness evolve --apply

📊 Harness Evolution - Evaluation
  Found 2 gaps...
  Generated 2 patches...
  
✅ Applied 2 patches
```

### 之后（第 2 阶段）

```bash
$ routa harness evolve --apply

🧠 Loaded learned playbook (confidence: 95%)
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

## 退出（Opt-Out）机制

用户可以禁用 playbook 加载：

```bash
# Disable playbook loading
routa harness evolve --apply --no-playbooks

# Or via environment variable
NO_PLAYBOOKS=1 routa harness evolve --apply
```

## 测试策略

### 单元测试

1. `test_load_playbooks_for_task` - 从目录加载
2. `test_find_matching_playbook` - 缺口模式匹配
3. `test_reorder_patches_by_playbook` - 补丁排序

### 集成测试

1. 创建 playbook + 运行 evolve → 验证补丁顺序
2. 多个 playbook → 验证选中最佳匹配
3. 无匹配 playbook → 验证不进行重新排序

## 实施计划

### 步骤 1：Playbook 加载（1 小时）
- [ ] 实现 `load_playbooks_for_task()`
- [ ] 添加单元测试
- [ ] 优雅处理 playbook 目录缺失的情况

### 步骤 2：模式匹配（1 小时）
- [ ] 实现 `find_matching_playbook()`
- [ ] 添加模糊匹配（部分重叠）
- [ ] 添加单元测试

### 步骤 3：预检引导（1 小时）
- [ ] 实现 `display_preflight_guidance()`
- [ ] 美化输出格式
- [ ] 在 JSON 模式下跳过

### 步骤 4：补丁重新排序（1 小时）
- [ ] 实现 `reorder_patches_by_playbook()`
- [ ] 保留不在 playbook 中的补丁
- [ ] 添加单元测试

### 步骤 5：集成（2 小时）
- [ ] 在 `evaluate_harness_engineering()` 中接入
- [ ] 添加集成测试
- [ ] 使用真实 playbook 进行测试

### 步骤 6：打磨（1 小时）
- [ ] 添加 `--no-playbooks` 标志
- [ ] 更新帮助文本
- [ ] 更新文档

**总预估**：7 小时（1 天）

## 成功标准

1. ✅ 存在 playbook 时自动加载
2. ✅ 基于缺口模式选中匹配的 playbook
3. ✅ 向用户展示预检引导
4. ✅ 按已学习的策略对补丁重新排序
5. ✅ 用户可按需退出
6. ✅ 所有测试通过
7. ✅ 文档已更新

## 后续步骤（第 3 阶段）

- Playbook 陈旧检测（30 天后过期）
- 跨仓库 playbook 共享
- Playbook 审批工作流
- 护栏（guardrail）提升（playbook → 适应度函数规则）
