---
title: 测试
---

# 测试

Routa 使用 `entrix` 和 `docs/fitness/` 规则手册作为源代码变更的规范化校验系统。

## 推荐的校验流程

对于源代码变更，请按以下顺序执行：

```bash
entrix run --dry-run
entrix run --tier fast
entrix run --tier normal
```

使用 `fast` 获取快速反馈；当行为、共享模块、API 或工作流编排发生变更时，使用 `normal`。

## 安装

```bash
cargo build -p entrix
```

## 各层级的含义

- `fast`：代码风格检查、静态分析和契约检查
- `normal`：单元测试、API 测试以及更广泛的代码质量门禁
- `deep`：运行时间更长的 UI、安全和回归验证证据

## UI 与运行时检查

- 使用 Playwright 进行自动化 UI 覆盖。
- 当 UI 发生变更时，使用浏览器或桌面端走查进行冒烟验证。
- 对于 Tauri UI 冒烟检查，运行 `npm run tauri dev` 并验证 `http://127.0.0.1:3210/`。

## 仅文档变更

如果变更严格属于非代码类，例如 `docs/`、`*.md`、`*.yml` 或 `.github/`，则可以跳过源代码校验。

## 规范化规则手册

完整的适应度函数和证据模型位于仓库规则手册中：

- [docs/fitness/README.md](https://github.com/phodal/routa/blob/main/docs/fitness/README.md)
