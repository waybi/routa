---
title: CLI
---

# CLI

如果你想要终端优先的使用方式或可脚本化的工作流，Routa CLI 是最佳的入口。

## 安装方式

### npm

```bash
npm install -g routa-cli
```

对大多数 CLI 用户来说，这是推荐的安装方式。

### Cargo

```bash
cargo install routa-cli
```

### 无需安装直接试用

```bash
npx -p routa-cli routa --help
```

## 初次使用的命令

```bash
routa --help
routa --version
routa -p "Explain the architecture of this repository"
routa -p "Plan the next refactor for this codebase"
routa acp runtime-status
```

## 适用场景

在以下情况下使用 CLI：

- 一次性提示词（one-shot prompts）
- Provider / 运行时状态检查
- 脚本化与自动化
- 仓库内的直接终端工作流

## 成功的标志

当你能够完成以下操作时，说明你首次的 CLI 配置已经生效：

- 运行 `routa --help`
- 使用 `routa -p "..."` 针对一个真实仓库执行一次提示词
- 使用 `routa acp runtime-status` 检查运行时状态

## 相关文档

- [Quick Start](/quick-start)
- [Configuration](/configuration)
- [Use Routa](/use-routa)
