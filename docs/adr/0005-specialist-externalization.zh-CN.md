# ADR 0005: Specialist 外部化

- Status: accepted
- Date: 2026-02-16
- Derived from: [issue #1](https://github.com/phodal/routa/issues/1)

## 背景

Specialist 定义了 Agent 角色（ROUTA、CRAFTER、GATE、DEVELOPER 等），包含行为指令、模型层级（model tier）偏好以及角色提醒（role reminder）。最初这些都硬编码在 TypeScript 中。

硬编码的 specialist 阻碍了：
- 用户在不改动代码的情况下进行自定义
- 针对工作区的角色配置
- 独立于版本发布、受版本控制管理的 specialist 演进

## 决策

Specialist 以带 YAML frontmatter 的 Markdown 文件形式外部化。加载遵循一条优先级链：

1. **数据库用户 specialist**（最高优先级）—— 针对每个工作区的覆盖
2. **用户文件系统**（`~/.routa/specialists/*.md`）—— 用户级默认值
3. **打包资源**（`resources/specialists/*.md`）—— 随应用一起发布
4. **硬编码兜底**—— 最后的退路

每个 specialist 文件包含：
```yaml
---
name: developer
description: Implements code changes
modelTier: standard
role: developer
roleReminder: Focus on clean, tested implementation
---
# Behavior instructions in Markdown body
```

## 影响

- 新增 specialist 角色的方式是在 `resources/specialists/` 中创建一个 `.md` 文件，而不是编辑 TypeScript。
- 用户可以通过在其工作区设置或 `~/.routa/specialists/` 中创建同名文件来覆盖任意打包的 specialist。
- 这条优先级链意味着 Agent 行为是确定性的：数据库优先于文件系统，文件系统优先于打包资源。
- TypeScript（`src/core/specialists/`）与 Rust（`crates/routa-core/src/store/`）都实现了这条加载链。
- 当从数据库加载时，specialist 定义的作用域限定在工作区内。

## 代码引用

- `resources/specialists/*.md` —— 打包的 specialist 定义
- `src/core/specialists/specialist-db-loader.ts` —— 优先级加载逻辑
- `src/core/models/specialist.ts` —— 带 YAML frontmatter 的 specialist 模型
- `crates/routa-core/src/store/specialist*.rs` —— Rust specialist 存储
