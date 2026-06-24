---
title: "Harness 监控自动执行全量图 test-mapping 可能触发仓库级内存激增"
date: "2026-04-21"
kind: issue
status: resolved
severity: high
area: harness-monitor
tags:
  - harness-monitor
  - entrix
  - test-mapping
  - graph
  - performance
  - memory
reported_by: "codex"
related_issues:
  - "docs/issues/2026-04-17-autoresearch-led-harness-fitness-speed-optimization.md"
github_issue: null
github_state: null
github_url: null
resolved_at: "2026-04-28"
resolution: "Harness 监控不再默认自动升级到全量图 test-mapping；选择启用需通过 HARNESS_MONITOR_ENABLE_FULL_TEST_MAPPING_REFRESH 门控。"
---

# Harness 监控自动执行全量图 test-mapping 可能触发仓库级内存激增

## 发生了什么

当 `harness-monitor` 在一个 dirty 文件集较小的仓库上打开时，它可能自动以 Full 模式生成 `entrix graph test-mapping --json` 子进程。在当前的 `routa-js` 工作区中，该子进程的私有内存可能攀升至 10 GB 以上，并持续消耗 CPU，直到机器内存耗尽或进程被杀掉。

即便 `harness-monitor` 本身保持小体量，该问题依然可见。活动监视器（Activity Monitor）显示 `harness-monitor` 仅占用数十 MB，而其子 `entrix` 进程的私有内存增长到约 14 GB，并持续接近 100% CPU。

## 预期行为

打开 `harness-monitor` 不应自动触发一次可能耗尽本地内存的仓库级图构建。任何昂贵的图感知增强（graph-aware enrichment）要么应保持在有界预算内，要么应要求显式选择启用（opt-in）。

## 复现上下文

- 环境：桌面端 / 本地终端
- 触发方式：在 `routa-js` 上打开 `harness-monitor`，让 test-mapping 从 Fast 预热到 Full，然后在活动监视器中观察生成的 `entrix` 子进程

## 为什么可能发生

- `harness-monitor` 目前会在 dirty 文件数低于某个基于计数的阈值时，将 Fast test-mapping 升级到 Full，而这一阈值并不能可靠地代表全仓图的成本
- `entrix graph test-mapping` 的 Full 模式会调用 `parse_repo_graph(repo_root)`，它会遍历并解析整个受支持语言的仓库，而非仅解析变更文件
- 图构建器通过广泛的符号对（symbol-pair）扫描来推导边，并存储大型中间结构，因此在较大仓库上内存成本可能急剧上升
- 当前的 test-mapping 图路径似乎会先构建一个完整的图，然后以 `ReviewBuildMode::Skip` 进行查询，因此这项昂贵的图工作甚至可能并未被调用方消费

## 相关文件

- `crates/harness-monitor/src/ui/cache.rs`
- `crates/harness-monitor/src/ui/cache_test_mapping.rs`
- `crates/entrix/src/test_mapping.rs`
- `crates/entrix/src/review_context/analysis.rs`
- `crates/entrix/src/review_context/tree_sitter/mod.rs`
- `crates/entrix/src/review_context/tree_sitter/graph_builder.rs`

## 观察

- `crates/entrix/src/test_mapping.rs` 中的 `graph_test_files_by_source()` 目前调用 `query_current_graph(..., ReviewBuildMode::Skip)`，它返回的是一个被跳过的结果，而非使用刚刚构建好的图
- 作为即时缓解措施，在图路径既有界又被证明确实有用之前，`harness-monitor` 不应默认自动升级到 Full 图刷新

## Issue 整理

- 2026-04-28：在确认 `crates/harness-monitor/src/ui/cache.rs` 默认跳过 Full 图刷新、且回归测试期望出现 `HARNESS_MONITOR_ENABLE_FULL_TEST_MAPPING_REFRESH=1` 选择启用提示消息后，标记为已解决。
