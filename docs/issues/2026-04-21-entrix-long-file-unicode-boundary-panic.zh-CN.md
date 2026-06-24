---
title: "Entrix 长文件预算 Hook 在 Unicode 注释边界处 panic"
date: "2026-04-21"
kind: issue
status: resolved
resolved_at: "2026-04-25"
severity: medium
area: entrix
tags:
  - entrix
  - long-file
  - unicode
  - commit-hook
  - panic
reported_by: "codex"
---

# Entrix 长文件预算 Hook 在 Unicode 注释边界处 panic

## 发生了什么

在一次正常的 `git commit` 过程中，文件预算 hook 打印了预期的超大文件警告，但随后在 `crates/entrix/src/long_file.rs` 内部发生了 panic：

`byte index 117 is not a char boundary; it is inside '─'`

该故障发生在处理一行包含制表（box-drawing）Unicode 字符的注释横幅时，例如：

`// ── Tools that don't require workspaceId ─────────────────────────────`

提交仍然完成了，因此这不是发布的硬性阻塞，但该 hook 的行为不可靠，并且可能掩盖真实的文件预算反馈。

## 预期行为

`entrix` 应当能够报告长文件预算警告而不发生 panic，即使源文件包含 Unicode 注释横幅或其他多字节字符。

## 可能的原因

- 长文件的格式化或切片逻辑似乎在需要 Rust 字符串字符边界的地方使用了字节偏移量
- hook 模式下的报告在构建结构摘要时很可能假定了 ASCII 安全的切片
- 超大文件报告与美化打印（pretty-print）格式化可能共享了一条不是 Unicode 安全的代码路径

## 相关文件

- `crates/entrix/src/long_file.rs`
- `crates/entrix/src/cli_output.rs`
- `crates/entrix/src/main.rs`

## 复现环境

1. 暂存一个包含超大文件的提交
2. 确保该文件包含 Unicode 注释横幅，例如 `─`
3. 运行 `git commit`
4. 观察到长文件警告，随后出现 panic

## 影响

- commit-hook 的输出变得嘈杂且可信度降低
- 真实的长文件指引可能被 panic 文本所掩盖
- 如果 panic 改变了退出行为，未来的自动化可能会误判 hook 结果

## 解决说明

- 将 Entrix 长文件注释预览格式化中的字节索引切片替换为字符安全的截断。
- 新增了一个回归测试，覆盖一条类似于 commit-hook 输出中出现的长 Unicode 制表注释横幅。

## 验证说明

- `cargo test -p entrix long_file -- --nocapture`
  - PASS（`8 passed`）
- `entrix run --tier fast`
  - PASS
