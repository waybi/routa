---
title: 架构质量
---

# 架构质量

Routa 通过统一的架构 DSL 和基于图（graph）的执行，为 TypeScript 和 Rust 后端代码提供实时的架构质量监控。

## 概览

架构质量系统帮助你：

- **强制约束** 核心模块、API 表面与客户端代码之间的**边界**
- **检测** 后端依赖图中的**循环依赖**
- 通过快照对比**跟踪**违规情况随时间的变化
- **一次定义规则**，并通过共享的 Rust 图运行器执行

## 快速开始

### 在 UI 中查看架构质量

1. 打开 **Settings → Harness**
2. 选择你的工作区和仓库
3. 点击 **Architecture** 标签页
4. 点击 **Run Architecture Scan**

扫描覆盖范围：
- 跨核心模块与 API 模块的后端边界泄漏
- 后端核心图内部的循环依赖热点
- 每次成功扫描后的快照对比

### 从命令行运行

```bash
# Run all architecture checks
npm run test:arch:backend-core

# Run only boundary checks
npm run test:arch:backend-core -- --suite boundaries

# Run only cycle checks
npm run test:arch:backend-core -- --suite cycles

# Get JSON output
npm run test:arch:backend-core -- --json
```

### Rust CLI

```bash
# Validate and inspect DSL rules
cargo run -p routa-cli -- fitness arch-dsl --json

# Parse and execute graph-backed rules
cargo run -p routa-cli -- graph analyze --dir src/core --lang typescript
```

## 架构规则

规则定义在 `architecture/rules/backend-core.archdsl.yaml` 中，使用 Routa 架构 DSL。

### 当前规则

#### 边界规则

1. **禁止 Core → App 依赖**
   - `src/core/**` 不得依赖 `src/app/**`
   - 防止领域逻辑与框架代码耦合

2. **禁止 Core → Client 依赖**
   - `src/core/**` 不得依赖 `src/client/**`
   - 使后端逻辑与浏览器代码隔离

3. **禁止 API → Client 依赖**
   - `src/app/api/**` 不得依赖 `src/client/**`
   - 防止服务端路由导入 UI 组件

#### 循环规则

4. **核心模块必须无环**
   - `src/core/**` 不应存在循环依赖
   - 确保清晰的分层和可测试性

## DSL 格式

规则以 YAML 编写，采用稳定的 schema（`routa.archdsl/v1`）：

```yaml
schema: routa.archdsl/v1

model:
  id: backend_core
  title: Backend Core Architecture
  owners: [fitness, backend]

selectors:
  core_ts:
    kind: files
    language: typescript
    include: [src/core/**]

rules:
  - id: ts_backend_core_no_core_to_app
    title: src/core must not depend on src/app
    kind: dependency
    suite: boundaries
    severity: advisory
    from: core_ts
    relation: must_not_depend_on
    to: app_ts
    engine_hints: [graph]
```

### 关键概念

- **选择器（Selectors）**：可复用的文件范围（例如 `core_ts`、`api_ts`）
- **规则（Rules）**：对依赖或循环的约束
- **套件（Suites）**：逻辑分组（例如 `boundaries`、`cycles`）
- **引擎提示（Engine hints）**：哪些执行器支持该规则（`graph`）

## UI 功能

### 多种视图

- **Summary**：通过/失败状态及违规计数的概览
- **Boundary Leaks**：失败的边界规则及其源 → 目标详情
- **Cycle Hotspots**：循环依赖路径
- **Violations**：按规则分组的所有违规

### 快照对比

每次扫描后，结果会保存到 `docs/fitness/reports/backend-architecture-latest.json`。UI 会自动与上一次扫描进行对比，以展示：

- 新增的失败规则
- 已解决的规则
- 违规数量的增量变化

### 下钻

点击任意失败的规则可查看：
- 具体的源文件和目标文件
- 依赖边的数量
- 循环的完整违规路径

## 与 Fitness 的集成

架构质量被注册为一个独立的适应度函数维度：

- **维度（Dimension）**：`architecture_quality`
- **权重（Weight）**：0（咨询模式，不影响总分）
- **层级（Tier）**：normal
- **执行范围（Execution scope）**：local（默认不在 CI 中运行）

### 指标

- `ts_backend_core_arch_boundaries`：TypeScript 后端边界约束
- `ts_backend_core_arch_cycles`：TypeScript 后端循环检测

## 多语言支持

UI 已完全本地化：

- **English**：所有标签和消息的完整英文翻译
- **中文**：完整的中文界面支持

翻译键位于 `src/i18n/locales/{en,zh}.ts` 中的 `settings.harness.architectureQuality` 下。

## 已知限制

1. **仅咨询模式**：当前作为本地检查运行，未在 CI 中强制执行
2. **仅支持 TypeScript 后端**：Rust 后端规则已定义，但尚未完全集成
3. **保留兼容性包装层**：`npm run test:arch:backend-core` 仍然通过 `scripts/fitness/check-backend-architecture.ts` 执行，但该脚本现在会转而调用 Rust CLI

## 后续计划

- 随着违规被修复，逐步提高规则权重
- 将覆盖范围扩展到更细粒度的切片/分层规则
- 集成 Rust 后端架构规则
- 添加用于自定义约束的规则编写 UI

## 相关文档

- [架构规则 DSL 设计](../design-docs/architecture-rule-dsl.md) - 完整的 DSL 规范与实现细节
- [Issue #286](https://github.com/phodal/routa/issues/286) - 原始功能提案

### 内部引用（不在 Docusaurus 中）

以下文件属于内部 fitness 框架，未发布到文档站点：

- `docs/fitness/README.md` - 整体 fitness 框架
- `docs/fitness/backend-architecture.md` - 包含指标配置的适应度函数维度定义
