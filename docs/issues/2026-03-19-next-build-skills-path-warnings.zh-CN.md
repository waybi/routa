---
title: "Next 构建持续输出 skills 路径与路由配置警告"
date: "2026-03-19"
status: resolved
severity: medium
area: "build"
tags: [nextjs, turbopack, build, skills, github-webhook, warnings]
reported_by: "Codex"
related_issues: []
---

# Next 构建持续输出 skills 路径与路由配置警告

## 发生了什么

`npm run build` 能够成功完成，但构建过程中始终会输出一组与本轮 specialist/session 改动无关的警告。

观察到的警告包括：

- Next.js 无法静态识别 `src/app/api/webhooks/github/route.ts` 中导出的 `config` 对象。
- Turbopack 在评估 skills 目录（catalog）和 skill loader 代码中的动态路径拼接以及 `fs.existsSync` / `fs.statSync` 访问时，报告了过于宽泛的文件匹配模式。
- 由于 `src/core/github/github-issue-sync.ts` 被参与构建图的路由所引用，类似的模式警告也会通过它浮现出来。

其结果是构建输出变得嘈杂，真正的回归问题更难被发现，而且路由级别的文件系统扫描看起来比预期的范围更广。

## 预期行为

- `npm run build` 应当在不出现这些重复警告的情况下完成。
- 路由模块不应依赖会让 Turbopack 推断出极宽泛文件系统 glob 的模式。
- 已废弃或被忽略的路由配置导出不应继续保留在生产构建路径中。

## 复现环境

- 环境：web
- 触发条件：2026-03-19 在主仓库中运行 `npm run build`，处于 specialist/session 验证期间

## 可能的原因

- GitHub webhook 路由仍然导出了一个旧式的 `config` 对象，而 App Router 不再希望以这种形式解析它。
- skills 目录（catalog）路由似乎以足够动态的方式构建候选路径，导致 Turbopack 将其扩展成庞大的文件系统匹配集。
- 共享的 skill 加载工具很可能将相同的宽泛路径行为暴露给多个路由，从而放大了警告数量。
- 构建期的静态分析可能在追踪导入时，将路由代码、本地 skill 发现和 GitHub issue 同步辅助逻辑混合在一起，从而扩大了被扫描的范围。

## 相关文件

- `src/app/api/webhooks/github/route.ts`
- `src/app/api/skills/catalog/route.ts`
- `src/core/skills/skill-loader.ts`
- `src/core/github/github-issue-sync.ts`

## 观察记录

- 本轮在验证 `feat(specialist): persist execution defaults in db and api` 和 `feat(session): inherit specialist defaults in web session creation` 时，这组警告复现了两次。
- 在出现警告之后，TypeScript 和页面生成仍然成功完成。
- 这些警告早于本轮改动就已存在，并非由 specialist/session 工作引入。

## 参考

- 2026-03-19 通过 `npm run build` 进行的本地验证运行

## 解决方案

- 通过在 `src/app/api/skills/catalog/route.ts` 中用稳定的、基于辅助函数的候选路径解析替换重复的动态搜索循环，收窄了 skills 目录（catalog）的文件系统路径扩展。
- 在 `src/core/skills/skill-loader.ts` 中收窄了共享 skill 发现路径的构建方式，使 project/global/repo 扫描不再通过会导致 Turbopack 追踪范围变宽的通用循环变量来构建路径。
- 通过让 `src/app/api/github/tree/route.ts` 直接从 `github-workspace` 导入 `getCachedWorkspace`，而非从 `@/core/github` barrel 导入，减少了无关的构建图引入。
- 简化了 `src/core/github/github-issue-sync.ts` 中的既有内容查找逻辑，使文件存在性检查与读取检查不再依赖于一个合并而成的动态路径变量。
- 确认本 issue 中提到的早期 webhook `config` 警告已是过时信息；`src/app/api/webhooks/github/route.ts` 现在已经只导出 `dynamic = "force-dynamic"`。

## 验证

- 2026-03-28 运行 `npm run build` 完成，未再出现先前的 Turbopack skills 路径警告。
- 2026-03-28 运行 `entrix run --tier normal` 完成，整体结果为 `PASS`。
