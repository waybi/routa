---
title: "由于 Instant 下溢，桌面端后端在 Windows 全新启动时崩溃"
date: "2026-05-22"
kind: issue
status: open
severity: high
area: "desktop"
tags: ["desktop", "windows", "rust", "docker", "startup"]
reported_by: "github"
related_issues: ["https://github.com/phodal/routa/issues/554"]
github_issue: 554
github_state: open
github_url: "https://github.com/phodal/routa/issues/554"
---

# 由于 Instant 下溢，桌面端后端在 Windows 全新启动时崩溃

## 发生了什么

Windows 桌面端应用在内嵌的 Rust 后端绑定到 `127.0.0.1:3210` 之后不久可能崩溃：

```text
overflow when subtracting duration from instant
```

报告指出，该崩溃在开机时间较短的机器上可复现，这表明启动代码从 `Instant::now()` 中减去了一个固定的时间间隔。

## 为什么重要

应用可能在 WebView 出现之前就退出。在刚刚启动的 Windows 系统上的用户无法可靠地启动桌面端应用。

## 根本原因

`DockerDetector::new()` 使用以下方式初始化其缓存时间戳：

```rust
Instant::now() - Duration::from_secs(3600)
```

在 Windows 上，从 `Instant` 中减去一个大于系统开机时长的时间间隔可能导致下溢并 panic。

## 修复方案

- 用 `checked_sub` 替换直接的 `Instant - Duration` 运算。
- 在发生下溢时回退到 `now`，同时通过 `cached_status: None` 保持初始缓存状态为过期。
- 为该饱和运算辅助函数添加一个回归测试。

## 验证计划

- `cargo test -p routa-core acp::docker::detector::tests`
- `cargo test -p routa-core`
- `entrix run --tier fast`

## 验证

- `cargo test -p routa-core acp::docker::detector::tests` 通过。
- `cargo build -p routa-server` 通过。
- `entrix run --tier fast` 通过。
