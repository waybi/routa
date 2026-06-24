---
title: "Docker 构建因缺少 npm postinstall 资源而失败"
date: "2026-05-22"
kind: issue
status: open
severity: medium
area: "docker"
tags: ["docker", "build", "npm", "postinstall"]
reported_by: "github"
related_issues: ["https://github.com/phodal/routa/pull/555", "https://github.com/phodal/routa/pull/578", "https://github.com/phodal/routa/issues/579"]
github_issue: 579
github_state: open
github_url: "https://github.com/phodal/routa/issues/579"
---

# Docker 构建因缺少 npm postinstall 资源而失败

## 发生了什么

`docker compose up` 在 Dockerfile 的依赖层阶段失败：

```text
Error: Cannot find module '/app/scripts/install/run-patch-package.mjs'
```

Dockerfile 在运行 `npm ci` 之前只复制了 `package.json` 和 `package-lock.json`，但根目录的生命周期脚本需要 `scripts/install/` 下的文件。

## 为什么重要

新用户无法从 `main` 构建默认的 Docker 镜像。该失败发生在应用构建开始之前，因此 Docker Compose 不是一条可用的搭建路径。

## 根本原因

依赖层为了缓存效率而有意只复制一小部分文件，但根目录的 `postinstall` 和 `prepare` 脚本是安装契约的一部分：

- `postinstall`：`node scripts/install/run-patch-package.mjs`
- `prepare`：`node scripts/install/run-hooks-sync.mjs`

当生命周期脚本在容器内运行时，这些脚本还需要 `patches/` 和 hook 运行时入口。

## 修复方案

- 在 Dockerfile 依赖阶段运行 `npm ci` 之前，复制 `scripts/install/`、`tools/hook-runtime/` 和 `patches/`。
- 其余应用源码仅在构建阶段复制。

## 验证计划

- `docker compose build app`
- `entrix run --tier fast`

## 验证

- `colima nerdctl -- build -t routa-js-build-check .` 通过。
- `docker-compose config` 通过。
- `entrix run --tier fast` 通过。

## 发布后续跟进

- GitHub issue #579 报告，尽管 PR #555 已在 `main` 上修复了 Docker 依赖层，最新稳定标签 `v0.18.1` 仍然无法构建。
- PR #578 在发布前向运行时镜像添加了 `git` 和 `ca-certificates`，覆盖了 #570 中提出的运行时 git 后续诉求。
- `v0.19.0` 是这两项修复的发布载体。发布分支验证包括 `npm ci --legacy-peer-deps`、`entrix run --dry-run` 和 `entrix run --tier fast`。
- 发布期间无法重新运行本地 Docker 构建冒烟测试，因为本机未安装 `docker` CLI；之前的 `colima nerdctl` 构建结果仍是本跟踪记录中最新的本地镜像构建证据。
