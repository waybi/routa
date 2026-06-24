---
title: 环境变量
---

# 环境变量

当前代码库暴露的最相关的环境变量如下：

```bash
ROUTA_RUST_BACKEND_URL=...
OPENCODE_SERVER_URL=...
OPENCODE_API_KEY=...
ANTHROPIC_API_KEY=...
ANTHROPIC_AUTH_TOKEN=...
OPENAI_API_KEY=...
CODEX_API_KEY=...
```

## 它们的作用

- `ROUTA_RUST_BACKEND_URL`：将 Web 端 UI 指向本地后端服务器
- `OPENCODE_SERVER_URL` / `OPENCODE_API_KEY`：启用基于 OpenCode SDK 的执行
- `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`：启用基于 Anthropic 的执行路径
- `OPENAI_API_KEY`：在受支持的场景下启用基于 OpenAI 的模型使用
- `CODEX_API_KEY`：在受支持的场景下启用基于 Codex 的流程

## 实用规则

只设置与你实际使用的 Provider 路径相匹配的变量。对于大多数首次运行：

- 桌面端用户通常从应用内的本地 Provider 或特定 Provider 的凭证开始
- CLI 用户通常从一个全局配置的 Provider 开始
- Web 端贡献者通常在本地开发时设置 `ROUTA_RUST_BACKEND_URL`
