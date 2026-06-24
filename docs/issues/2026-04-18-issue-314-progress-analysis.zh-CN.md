---
title: "Issue #314 进度分析：自举的 Harness 工程 Agent"
date: "2026-04-18"
kind: verification_report
status: resolved
severity: low
area: "fitness"
tags: ["harness", "harness-engineering", "progress-analysis"]
reported_by: "agent"
github_issue: 314
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/314"
resolution: "全部 7 项验收标准均已完整实现并验证。该 Issue 可以关闭。"
---

# Issue #314 进度分析

> **日期**：2026-04-18
> **Issue**：[#314 设计一个自举的、由适应度函数驱动的 Harness 工程 Agent](https://github.com/phodal/routa/issues/314)
> **结论**：✅ 全部验收标准均已满足 —— 可以关闭

## 验收标准状态

### ✅ 1. 一个专用的 Harness 工程 Agent 能够同时读取仓库信号、适应度函数输入以及 Harness 表面

**实现**：`crates/routa-cli/src/commands/harness/engineering/mod.rs`

- `evaluate_harness_engineering()` 编排完整的循环
- 读取内容：仓库信号（`detect_repo_signals()`）、Harness 模板（`harness_template::doctor()`）、自动化接线（`detect_repo_automations()`）、spec 来源（`detect_spec_sources()`）、流畅度快照（`generic` 与 `agent_orchestrator` 两种 profile）、适应度函数规则手册（`docs/fitness/manifest.yaml`）
- 专家定义：`resources/specialists/tools/harness-engineering-evolution.yaml`

### ✅ 2. 该 Agent 输出结构化的缺口分类，而不仅仅是原始建议

**实现**：`crates/routa-cli/src/commands/harness/engineering/mod.rs` + `types.rs`

- 6 个结构化缺口类别：`missing_execution_surface`、`missing_verification_surface`、`missing_evidence`、`missing_automation`、`missing_governance_gate`、`non_harness_engineering_gap`
- 分类函数：`classify_repo_signals()`、`classify_templates()`、`classify_automations()`、`classify_specs()`、`classify_fitness()`、`classify_fluency_blocker()`
- 输出类型：`HarnessEngineeringGap`，包含字段：`id`、`category`、`severity`、`title`、`detail`、`evidence`、`suggested_fix`、`harness_mutation_candidate`

### ✅ 3. 系统能够区分 Harness 缺口与非 Harness 工程缺口

**实现**：`classify_fluency_blocker()` 启发式

- Harness 模式（codeowners、dependabot、review-trigger、harness、automation、surface、entrypoint、fitness）→ 归类为 Harness 变更目标
- 非 Harness 模式 → 归类为 `non_harness_engineering_gap`，其 `harness_mutation_candidate: false`
- 汇总单独统计 `non_harness_gaps` 数量

### ✅ 4. 该 Agent 能够在 dry-run 模式下提出低风险的 Harness 演进步骤

**实现**：`build_patch_candidates()` + CLI `--dry-run` 标志

- 7 种补丁类型：构建表面、测试表面、Harness 模板、codeowners、dependabot、覆盖率阈值、运维文档
- 全部归类为「low」或「medium」风险
- 默认行为：评估优先（dry-run）
- CLI：`routa harness evolve --dry-run --format json`

### ✅ 5. 提出的变更之后会进行验证，而非盲目发出

**实现**：`apply.rs` + `ratchet.rs`

- 快照 → 应用 → 验证 → 棘轮（Ratchet）→ 回滚（失败时）
- 4 步验证计划：Harness 工程 dry-run、表面检测、模板漂移 doctor、适应度函数规则手册 dry-run
- 棘轮强制：比较应用前后的流畅度基线，防止回退
- 回滚安全保障：`rollback_snapshot()` 在验证失败时恢复原始文件

### ✅ 6. 结果以报告或快照形式持久化，便于随时间对比

**实现**：`mod.rs` + `history.rs` + `learning.rs`

- 报告：`docs/fitness/reports/harness-engineering-latest.json`
- 演进历史：`docs/fitness/evolution/history.jsonl`（8+ 条记录）
- Playbook：`docs/fitness/playbooks/*.json`（从 3+ 次成功运行中自动生成）
- Trace 学习：模式提取 → Playbook 生成 → 运行时补丁重排序

### ✅ 7. docs/fitness/README.md 或相关设计文档中的文档说明了该循环及其边界

**实现**：多处位置

- `docs/fitness/README.md` 第 43-119 行：CLI 快速开始、Harness 工程循环说明、边界
- `docs/design-docs/harness-trace-learning-phase2.md`：完整的架构设计文档（276 行）
- `docs/issues/2026-04-06-issue-314-fixes-complete.md`：实现证据

## 测试验证

全部 19 个 Harness 工程测试通过：

```
running 19 tests
test commands::harness::engineering::tests::bootstrap_detects_weak_repo ... ok
test commands::harness::engineering::tests::bootstrap_skips_repo_with_existing_harness ... ok
test commands::harness::engineering::tests::detects_fluency_automation_target_mismatch ... ok
test commands::harness::engineering::tests::classifies_fluency_blockers_into_harness_and_non_harness ... ok
test commands::harness::engineering::tests::rollback_snapshot_removes_newly_created_files ... ok
test commands::harness::engineering::tests::reports_missing_bootstrap_surfaces_for_weak_repo ... ok
test commands::harness::engineering::tests::verification_plan_executes_successfully ... ok
test commands::harness::engineering::tests_learning::test_detect_common_patterns ... ok
test commands::harness::engineering::tests_learning::test_find_matching_playbook ... ok
test commands::harness::engineering::tests_learning::test_fuzzy_matching_playbook ... ok
test commands::harness::engineering::tests_learning::test_generate_playbook_candidates ... ok
test commands::harness::engineering::tests_learning::test_load_evolution_history ... ok
test commands::harness::engineering::tests_learning::test_load_playbooks_for_task ... ok
test commands::harness::engineering::tests_learning::test_no_match_when_overlap_too_low ... ok
test commands::harness::engineering::tests_learning::test_reorder_patches_by_playbook ... ok
test commands::harness::engineering::tests_learning::test_save_playbook ... ok
test commands::harness::engineering::tests::verification_plan_reports_failures ... ok
test commands::harness::engineering::tests::apply_mode_rolls_back_when_ratchet_regresses ... ok
test commands::harness::engineering::tests::apply_mode_creates_harness_files ... ok

test result: ok. 19 passed; 0 failed; 0 ignored
```

## 阶段完成情况汇总

| 阶段 | 描述 | 状态 |
|-------|-------------|--------|
| Phase 1 | 评估 + 引导式演进 | ✅ 完成 |
| Phase 2 | Bootstrap 模式 | ✅ 完成 |
| Phase 3 | 受控自动演进 | ✅ 完成 |
| Phase 3.5 | Trace 学习（Playbook） | ✅ 完成 |

## 实现规模

```
crates/routa-cli/src/commands/harness/engineering/
├── mod.rs              (1,308 lines) - 评估、分类、建议
├── types.rs            (302 lines)   - 类型定义
├── apply.rs            (797 lines)   - 补丁应用、验证、回滚
├── ratchet.rs          (339 lines)   - 基线比较、防回退
├── bootstrap.rs        (274 lines)   - 弱仓库检测、初始表面合成
├── learning.rs         (438 lines)   - 模式提取、Playbook 生成
├── history.rs          (232 lines)   - 演进结果记录
├── tests.rs            (461 lines)   - 核心测试（11 个用例）
└── tests_learning.rs   (377 lines)   - 学习测试（8 个用例）
```

## 发现的缺口：无

全部 7 项验收标准均已完整满足。该实现超出了 Issue 中所列的 Phase 1 范围，还完成了 Phase 2 和 Phase 3。

## 建议

**关闭 Issue #314。** 全部验收标准均已满足，测试通过，文档完整，完整的 观察 → 评估 → 合成 → 验证 → 棘轮 → 学习 循环已可运行。
