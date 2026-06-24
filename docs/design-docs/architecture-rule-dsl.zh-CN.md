---
title: 架构规则 DSL
---

# 架构规则 DSL

## Purpose

Routa 现在已经有了一个可用的 TypeScript 架构适应度函数面，但规则集仍然内嵌在 `scripts/fitness/check-backend-architecture.ts` 中。这让首次 ArchUnitTS 集成得以推进，但它阻碍了三个后续目标：

- 在 TypeScript 与 Rust 后端之间复用相同的规则意图
- 使用 LLM 生成或编辑规则，而无需改动可执行代码
- 向适应度函数、UI 以及未来基于图的执行器提供一个稳定、结构化的规则模型

本文档为这些目标定义了一个小型、与引擎无关的架构规则 DSL。

## Goals

- 维护一个机器可读的规则模型，TypeScript 与 Rust 都能解析。
- 在不改变其用户可见含义的前提下，保留当前 ArchUnitTS 的边界规则与环依赖规则。
- 将规则意图与执行器代码分离。
- 让 DSL 足够简单，以便 LLM 生成和评审。
- 为未来的执行器留出空间，例如 Rust 图分析、dep-tree 适配器或仓库级拓扑检查。

## Non-Goals

- 这在第一次迭代中并不是一门完整的架构语言。
- 它尚未在每个引擎上执行每个规则族。
- 它不会取代 `dependency-cruiser`、`entrix` 或当前的架构 API 响应结构。
- 它不会把 UI i18n 移入执行器。DSL 仅携带稳定的 id 以及可选的展示元数据。

## Design Principles

- 一个文件应描述一个连贯的规则模型。
- 选择器（selector）应在规则之间可复用。
- 规则语义不应依赖于某一个执行器实现。
- 不受支持的规则必须显式地校验失败，而不是被静默忽略。
- LLM 应能在较低的提示复杂度下产出有效的文件。

## File Format

规范格式为 YAML。

推荐的文件扩展名：

- `*.archdsl.yaml`

Schema id：

- `routa.archdsl/v1`

承载该标识符的顶层 DSL 文件字段为：

```yaml
schema: routa.archdsl/v1
```

推荐的存放位置：

- `architecture/rules/`

## Core Model

每个 DSL 文件包含：

1. `schema`
2. `model`
3. `defaults`
4. `selectors`
5. `rules`

### `model`

`model` 将规则包标识为一个持久化单元。

字段：

- `id`：稳定的机器 id
- `title`：人类可读的标签
- `description`：简短的范围摘要
- `owners`：可选的逻辑所有者，例如 `fitness`、`backend` 或 `platform`

### `defaults`

共享的文件系统默认值。

字段：

- `root`：可选的根目录，默认为 `.`
- `exclude`：可选的忽略 glob

### `selectors`

选择器为可复用的文件范围命名。

当前的选择器类型：

- `files`

当前的选择器字段：

- `kind`
- `language`：精确的小写值 `typescript` 或 `rust`（未来的 schema 版本可能新增其他取值）
- `include`：glob 列表
- `exclude`：可选的 glob 列表
- `description`：可选的简短意图说明

示例：

```yaml
selectors:
  core_ts:
    kind: files
    language: typescript
    include:
      - src/core/**
```

### `rules`

规则描述与引擎无关的意图。

共享的规则字段（所有规则都需要这些）：

- `id`：稳定的机器 id
- `title`：用于 CLI/调试输出的可读标签
- `kind`：规则类型，目前为 `dependency` 或 `cycle`
- `suite`：套件标签，目前为 `boundaries` 或 `cycles`
- `severity`：`advisory`、`warning` 或 `error`
- `relation`：语义选择器
- `engine_hints`（可选）：执行提示，例如 `archunitts` 和/或 `graph`

兼容性约束：

- `dependency` 需要 `from` 和 `to`
- `cycle` 需要 `scope`
- 所有规则类型都需要 `relation`
- `dependency` 需要 `relation: must_not_depend_on`
- `cycle` 需要 `relation: must_be_acyclic`

#### Dependency Rule

字段：

- `from`：选择器 id
- `relation`：目前为 `must_not_depend_on`
- `to`：选择器 id

支持的组合：

- `kind: dependency`
- `suite: boundaries`
- `relation: must_not_depend_on`
- 执行器支持：`archunitts`（仅限 typescript 选择器）或 `graph`（单一语言选择器）

示例：

```yaml
- id: ts_backend_core_no_core_to_client
  title: src/core must not depend on src/client
  kind: dependency
  suite: boundaries
  severity: advisory
  from: core_ts
  relation: must_not_depend_on
  to: client_ts
  engine_hints:
    - archunitts
```

#### Cycle Rule

字段：

- `scope`：选择器 id
- `relation`：目前为 `must_be_acyclic`

支持的组合：

- `kind: cycle`
- `suite: cycles`
- `relation: must_be_acyclic`
- 执行器支持：`archunitts`（仅限 typescript 选择器）或 `graph`（单一语言选择器）

示例：

```yaml
- id: ts_backend_core_no_cycles
  title: src/core should be cycle free
  kind: cycle
  suite: cycles
  severity: advisory
  scope: core_ts
  relation: must_be_acyclic
  engine_hints:
    - archunitts
```

## Why YAML

YAML 是推荐的规范语法，因为它已是仓库中常见的配置格式，并且在两条实现路径上都有良好支持：

- TypeScript：使用 `js-yaml` 解析、`zod` 校验
- Rust：使用 `serde_yaml` 配合类型化的枚举/结构体

这让 DSL 对人类可检视、便于 LLM 产出，并对未来的工具链保持稳定。

## TypeScript Implementation Strategy

推荐方案：

1. 使用 `js-yaml` 解析 YAML。
2. 使用 `zod` 校验原始文档。
3. 将归一化后的模型编译为当前的 ArchUnitTS `ArchitectureRuleDefinition[]`。
4. 保持当前的 JSON 报告结构，使现有的 API/UI 消费方保持稳定。

为什么采用该方案：

- 它复用了现有的 `scripts/fitness/check-backend-architecture.ts` 执行路径。
- 它让首次生产上线尽量贴近当前可用的行为。
- 它使规则执行成为一个从 DSL 到 ArchUnitTS 构建器的纯编译步骤。

当前上线范围：

- `files` 选择器
- `dependency` + `must_not_depend_on`
- `cycle` + `must_be_acyclic`
- `boundaries` 和 `cycles` 套件

## Rust Implementation Strategy

推荐方案：

1. 新增一个 `routa-cli fitness arch-dsl` 命令。
2. 使用 `serde` + `serde_yaml` 将 YAML 解析为类型化结构体。
3. 运行语义校验：
   - schema id 受支持
   - 选择器 id 唯一
   - 规则引用已存在的选择器
   - `kind`、`relation` 以及选择器语言的组合受支持
4. 直接执行 `graph` 支撑的规则，并以文本或 JSON 形式输出归一化的执行计划。

为什么采用该方案：

- 它证明了该 DSL 并未与 TypeScript 运行时耦合。
- 它立即为 Routa 提供了第二个解析器和校验器。
- 它为未来基于 Rust 的架构执行器创建了一个清晰的交接点。

当前的执行边界：

- Rust 负责校验并归一化 DSL。
- Rust 直接从 CLI 执行 `graph` 支撑的依赖规则与环依赖规则。
- 与 ArchUnitTS 兼容的规则仍由 TypeScript 适应度函数路径负责。
- TypeScript 的 `ArchUnitTS` 规则仍通过 `scripts/fitness/check-backend-architecture.ts` 执行。

## Normalized Semantic Contract

两个实现都应收敛到相同的语义假设：

- 在一个文件内，选择器 id 全局唯一
- 在一个文件内，规则 id 全局唯一
- 每条规则都引用已存在的选择器
- `dependency` 规则需要 `from` 和 `to`
- `cycle` 规则需要 `scope`
- TypeScript 的 ArchUnitTS 编译目前仅支持 `language: typescript`
- 不受支持的组合必须产生显式的校验错误

## LLM-Friendly Case Format

LLM 创作格式应为带有 YAML frontmatter 和可预测分节的 Markdown。

推荐目录：

- `architecture/rules/cases/`

推荐的文件扩展名：

- `*.archdsl.md`

必需的 frontmatter：

- `schema`
- `case_id`
- `target_dsl`
- `output_format`
- `temperature_hint`

frontmatter 语义：

- `schema` 必须为 `routa.archdsl.case/v1`
- `case_id` 是该 case 提示词及评审 Trace 的稳定 ID
- `target_dsl` 是生成的 DSL 文件相对于仓库的输出路径
- `output_format` 是所需的生成产物模式，目前为 `yaml`
- `temperature_hint` 保持生成的确定性与低方差，目前为 `low`

推荐分节：

1. `# Goal`
2. `## Context`
3. `## Selector Catalog`
4. `## Required Rules`
5. `## Constraints`
6. `## Output Contract`

不受支持的组合与校验失败：

- `archunitts` 只能在 `typescript` 选择器上运行，且每个选择器恰好只有一个 include 模式
- `graph` 仅在所有被引用的选择器使用同一语言时运行
- 如果某条规则引用了未知选择器、混合的图语言或不兼容的引擎约束，校验会报告一个显式问题，并将计划/校验标记为失败

为什么采用该格式：

- frontmatter 携带稳定的路由元数据
- 标题为 LLM 提供一致的锚点
- 文件保持对 diff 友好且可评审
- 输出契约可强制要求仅输出 YAML

## Validation Workflow

1. 创作或更新 Markdown case。
2. 让 LLM 仅为目标 DSL 输出 YAML。
3. 用 TypeScript 编译器路径校验输出的 YAML。
4. 用 Rust 解析器路径校验同一份 YAML。
5. 将成功的输出提升到 `architecture/rules/*.archdsl.yaml`。

这使得 Markdown case 成为生成的输入契约，而非执行的真实来源。

## Current Layout

当前上线使用以下文件：

- `architecture/rules/backend-core.archdsl.yaml`
- `architecture/rules/cases/backend-core.archdsl.md`
- `scripts/fitness/architecture-rule-dsl.ts`
- `scripts/fitness/check-backend-architecture.ts`
- `crates/routa-cli/src/commands/fitness/arch_dsl.rs`

## Future Extensions

首次上线之后预期的下一批规则族：

- 分层（layered）规则
- 切片隔离（slice isolation）规则
- crate 或 package 依赖规则
- 禁止的符号/Provider 泄露规则
- 基于图的选择器与 quantums 集成

`v1` schema 刻意保持精简，使这些扩展能够在不改造最初四条 backend-core 规则的前提下加入。
