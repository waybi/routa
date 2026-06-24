# 架构质量 - 快速参考

## 📚 文档位置

### 在线（GitHub Pages）⭐ 推荐

所有文档均发布到 GitHub Pages 并自动更新：

- **🚀 用户指南**: https://phodal.github.io/routa/features/architecture-quality
  - 快速开始、CLI 使用、UI 功能、示例

- **📖 DSL 规范**: https://phodal.github.io/routa/design-docs/architecture-rule-dsl
  - 完整的 DSL schema、语法、设计原则
  - TypeScript 和 Rust 实现策略
  - LLM 生成指南

- **🏠 设计文档索引**: https://phodal.github.io/routa/design-docs
  - 浏览所有设计文档，包括 Architecture Rule DSL

### 本地开发

在本地查看文档：
```bash
# Build and serve docs
npx docusaurus build --out-dir docs-site
npx docusaurus serve --dir docs-site --port 3001

# Then open:
# - http://localhost:3001/routa/features/architecture-quality (User Guide)
# - http://localhost:3001/routa/design-docs/architecture-rule-dsl (DSL Spec)
```

## 🎯 快速开始

### 1. 在 UI 中查看

1. 打开 Routa 桌面端或 Web 端
2. 进入 **Settings → Harness**
3. 选择一个工作区和仓库
4. 点击 **Architecture** 标签页
5. 点击 **Run Architecture Scan**

### 2. 从 CLI 运行

```bash
# Run all checks
npm run test:arch:backend-core

# Run specific suite
npm run test:arch:backend-core -- --suite boundaries
npm run test:arch:backend-core -- --suite cycles

# Get JSON output
npm run test:arch:backend-core -- --json
```

### 3. 查看结果

- **UI**: 在 Architecture 标签页中查看，提供多个视图（Summary、Boundaries、Cycles、Violations）
- **快照**: 查看 `docs/fitness/reports/backend-architecture-latest.json`
- **API**: 调用 `GET /api/fitness/architecture`

## 📋 它检查什么

### 边界规则

- ✅ `src/core/**` 不得依赖 `src/app/**`
- ✅ `src/core/**` 不得依赖 `src/client/**`
- ✅ `src/app/api/**` 不得依赖 `src/client/**`

### 循环规则

- ✅ `src/core/**` 应当无循环依赖

## 🔧 配置

### 规则定义

编辑 `architecture/rules/backend-core.archdsl.yaml` 以：
- 添加新的 selector
- 定义新规则
- 修改严重级别
- 添加 engine hints

### DSL 格式

```yaml
schema: routa.archdsl/v1

selectors:
  my_module:
    kind: files
    language: typescript
    include: [src/my-module/**]

rules:
  - id: my_rule
    title: My custom rule
    kind: dependency
    suite: boundaries
    severity: advisory
    from: my_module
    relation: must_not_depend_on
    to: other_module
    engine_hints: [archunitts, graph]
```

## 🌐 多语言支持

UI 已完全本地化：
- **English**: 完整翻译
- **中文**: 完整中文支持

翻译位于 `src/i18n/locales/{en,zh}.ts` 的 `settings.harness.architectureQuality` 之下。

## 📊 集成状态

- ✅ **UI**: 已完全集成到 Harness 控制台
- ✅ **API**: `/api/fitness/architecture` 端点
- ✅ **CLI**: TypeScript 和 Rust 命令
- ✅ **Fitness**: 已注册为 `architecture_quality` 维度（weight: 0，advisory 模式）
- ✅ **DSL**: 跨语言 YAML 格式
- ✅ **Docs**: 已发布到 GitHub Pages

## 🔗 相关文件

### 源代码
- `src/client/components/harness-architecture-quality-panel.tsx` - UI 面板
- `src/app/api/fitness/architecture/route.ts` - API 端点
- `scripts/fitness/check-backend-architecture.ts` - Rust CLI 的兼容性封装
- `crates/routa-cli/src/commands/fitness/arch_dsl.rs` - 主图执行器

### 配置
- `architecture/rules/backend-core.archdsl.yaml` - 规则定义
- `docs/fitness/backend-architecture.md` - Fitness 维度配置

### 文档
- `docs/features/architecture-quality.md` - 用户指南（Docusaurus）
- `docs/design-docs/architecture-rule-dsl.md` - DSL 规范（Docusaurus）

## 📝 贡献

添加新的架构规则：

1. 编辑 `architecture/rules/backend-core.archdsl.yaml`
2. 使用 `npm run test:arch:dsl` 进行测试
3. 使用 `npm run test:arch:backend-core` 运行检查
4. 在 UI 中通过 Settings → Harness → Architecture 进行验证

## ⚠️ 已知限制

- **Advisory 模式**: 当前 weight: 0，未在 CI 中强制执行
- **仅 TypeScript**: Rust 后端规则已定义但尚未完全集成

---

**完整文档请访问: https://phodal.github.io/routa/features/architecture-quality**
