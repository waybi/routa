---
title: "桌面端发布构建将 feature-tree 生成器解析到编译期构建路径"
date: "2026-04-22"
kind: issue
status: resolved
resolved_at: "2026-04-22"
severity: high
area: "desktop-feature-tree"
tags: ["desktop", "feature-tree", "tauri", "release"]
reported_by: "codex"
github_issue: 522
github_state: closed
github_url: "https://github.com/phodal/routa/issues/522"
---

# 发生了什么

Rust 的 feature-tree 桥接通过 `env!("CARGO_MANIFEST_DIR")` 解析 `scripts/docs/feature-tree-generator.ts`。

这在本地源码检出中可以正常工作，但 Tauri 发布构建会保留构建机器在编译期的 manifest 路径。因此在已分发的桌面端二进制文件中，feature-tree 生成会尝试读取如下路径：

- `/Users/runner/work/routa/routa/crates/routa-server/../../scripts/docs/feature-tree-generator.ts`

这些路径在终端用户的机器上并不存在，因此 feature-tree 生成在任何仓库扫描开始之前就失败了。

# 为什么重要

- 桌面端发布版用户无法生成或提交 `FEATURE_TREE.md`。
- 该失败发生在 Rust 后端内部，因此桌面端 UI 流程和 Rust CLI 桥接都继承了同样脆弱的路径假设。
- 错误信息指向的是构建机器上的路径，这掩盖了真正的发布打包缺口。

# 解决方案

- 在 `scripts/prepare-frontend.mjs` 期间，将一个发布安全的 `feature-tree-generator.mjs` 打包进 Tauri 资源中。
- 通过 `ROUTA_FEATURE_TREE_RESOURCE_DIR` 将 Tauri 资源目录暴露给 Rust 后端。
- 让 Rust 的 feature-tree 执行优先使用运行时提供的生成器路径，并在不依赖 `tsx` 的情况下执行 JavaScript 包。
- 运行打包的发布安全 `.mjs` 生成器时，以目标 `repo_root` 作为 `current_dir`；而源码检出的 `.ts` 生成器仍从 Routa 工作区根目录执行，并通过 `--repo-root` 接收目标仓库。这样既能让桌面端发布构建保持仓库本地化，又不会破坏源码检出和测试中的 `tsx` 解析。
- 在 `apps/desktop/src-tauri/bundled/feature-tree/` 下保留一个签入的占位文件，以便在 `prepare-frontend` 生成真正的包之前，本地源码检出在 `cargo clippy` / pre-push 校验期间仍能满足 Tauri 资源 glob。
