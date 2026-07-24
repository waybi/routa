---
title: Specialist 人设体系：Agent 的"角色说明书"怎么运作
prerequisite: 04-three-modes-compared.zh-CN.md
---

# Specialist 人设体系：Agent 的"角色说明书"怎么运作

> 接着[三种模式对比](04-three-modes-compared.zh-CN.md)深入。
> 前四篇里反复出现 ROUTA / CRAFTER / GATE / DEVELOPER 这些角色名，
> 以及"加载 specialist""拼 system prompt"这些操作。本文打开这个体系，讲清楚：
> 1. 一个 specialist 文件长什么样
> 2. 系统怎么找到它（四层优先级链）
> 3. 多语言怎么切（locale overlay）
> 4. 最终怎么注入到 ACP 会话里
>
> 本文是**学习笔记**，不是规范来源。事实以
> [ADR-0005](../adr/0005-specialist-externalization.md) 和代码为准。

## 0. 一句话抓住本质

> **Specialist = 一份 YAML+Markdown 文件，里面写着"你是谁、你该怎么干活"。**
> 系统按优先级从四个地方找这份文件，找到后把 `system_prompt` 注入 ACP 会话，
> Agent 就"变成"了这个角色。换一份文件，同一个 AI CLI 就变成另一个人。

## 1. 一个 Specialist 文件长什么样

以 `claude-code` 这个 specialist 为例（`resources/specialists/tools/claude-code.yaml`）：

~~~yaml
id: "claude-code"
name: "Claude Code"
description: "Claude Code SDK integration specialist for AI-assisted development"
role: "DEVELOPER"
model_tier: "smart"
role_reminder: "You are Claude Code, an AI coding assistant.
               Focus on understanding the task, writing clean code,
               and providing clear explanations."
execution:
  provider: "claude"

system_prompt: |
  ## Claude Code

  You are Claude Code, an AI coding assistant integrated via the Claude Code SDK.
  Your job is to help developers write, review, and improve code.

  ## Core Capabilities
  ### 1. Code Generation
  - Write clean, maintainable code
  - Follow project conventions and patterns
  ...

  ## Hard Rules
  1. **Safety First** — Never suggest code that could harm systems or data
  2. **Honesty** — Acknowledge limitations and uncertainties
  3. **Minimal Changes** — Make the smallest change that solves the problem
  4. **Test Everything** — Verify changes work as expected
  5. **Document Decisions** — Explain non-obvious choices
~~~

**每个字段的含义：**

| 字段 | 作用 | 示例 |
|---|---|---|
| `id` | 唯一标识，用于查找和引用 | `"claude-code"`, `"crafter"`, `"gate"` |
| `name` | 显示名 | `"Claude Code"` |
| `description` | 一句话描述 | `"AI-assisted development specialist"` |
| `role` | 角色枚举 | `ROUTA` / `CRAFTER` / `GATE` / `DEVELOPER` |
| `model_tier` | 模型档位 | `fast` / `balanced` / `smart` |
| `role_reminder` | 二级行为提醒（注入在 system prompt 之后） | `"Focus on clean code..."` |
| `execution.provider` | 指定用哪个 ACP Provider | `"claude"` / `"opencode"` |
| `system_prompt` | **核心：Agent 的完整行为指令（Markdown 格式）** | 几十到几百行 |

**`system_prompt` 就是 Agent 的灵魂。** 换掉这段文字，同一个 Claude Code CLI 进程
就会表现出完全不同的行为——从写代码的 CRAFTER 变成只做验证的 GATE。

## 2. 四层优先级链：系统怎么找到 Specialist

当系统需要一个 specialist（比如 Kanban 自动化要启动一个 CRAFTER），它按**从高到低的优先级**依次查找：

~~~plaintext
优先级 100：Database（数据库）
   │  per-workspace 覆盖，通过 Web UI 创建和管理
   │  最高优先级——用户在界面上配的永远赢
   │
   ▼  找不到？
优先级 75：User Files（用户文件系统）
   │  ~/.routa/specialists/*.yaml
   │  用户级默认配置，跨工作区生效
   │
   ▼  找不到？
优先级 50：Bundled Resources（打包资源）
   │  resources/specialists/*.yaml
   │  随 Routa 发布的默认 specialist 定义
   │
   ▼  找不到？
优先级 25：Hardcoded Fallback（硬编码回退）
   │  src/core/orchestration/specialist-prompts.ts
   │  2000+ 行的 TypeScript 字符串，最后防线
   │  保证系统永远不会因为"找不到 specialist"而崩溃
   ▼
~~~

**为什么需要四层？**

- **Database**：让用户在 Web UI 上就能自定义角色，不用改文件
- **User Files**：让高级用户用文件系统管理，可以 git 版本控制
- **Bundled**：让新安装的 Routa 开箱即用，不用配任何东西
- **Hardcoded**：最后保底——即使文件全丢了，四个核心角色也还能工作

**重复 ID 怎么处理？** 高优先级赢。如果 Database 里有一个 `id: "crafter"` 的 specialist，
它会覆盖 Bundled 里的同名文件。用户可以"魔改"任何内置角色。

## 3. Locale Overlay：同一个角色，换一种语言

Routa 支持**同一个 specialist 提供多语言版本**。机制是文件系统 overlay（覆盖层）：

~~~plaintext
resources/specialists/
├── tools/
│   └── claude-code.yaml          ← 英文原版（base）
└── locales/
    └── zh-CN/
        └── tools/
            └── claude-code.yaml  ← 中文覆盖版（overlay）
~~~

**英文原版**（base）：

~~~yaml
id: "claude-code"
name: "Claude Code"
description: "Claude Code SDK integration specialist for AI-assisted development"
role_reminder: "You are Claude Code. Focus on understanding the task,
               writing clean code, and providing clear explanations."
system_prompt: |
  You are Claude Code, an AI coding assistant...
~~~

**中文覆盖版**（`locales/zh-CN/`）：

~~~yaml
id: "claude-code"
name: "Claude Code"
description: "通过 Claude Code SDK 提供代码生成、审查、解释与调试能力"
roleReminder: "你是 Claude Code。保持中文输出，先理解任务，再给出清晰、最小且高质量的代码改动。"
system_prompt: |
  你是集成在 Claude Code SDK 中的 AI 编码助手，负责帮助开发者编写、审查、解释和改进代码...
~~~

**运行时怎么切？**

~~~plaintext
Kanban 列配置里：
  automation:
    specialistLocale: "zh-CN"    ← 这一列触发的 Agent 说中文

加载逻辑：
  loadSpecialists(locale = "zh-CN")
     │
     ├─ 先加载 base: resources/specialists/tools/claude-code.yaml
     ├─ 再加载 overlay: resources/specialists/locales/zh-CN/tools/claude-code.yaml
     └─ 按 ID 合并：overlay 的字段覆盖 base 的同名字段
         → description 变成中文
         → roleReminder 变成中文
         → system_prompt 变成中文
         → 其他字段（role, model_tier 等）保持不变
~~~

**效果：同一个 `claude-code` specialist，在中文工作区里会用中文系统 prompt，
Agent 就会用中文思考和输出。**

## 4. 四个核心角色的行为差异

Specialist 体系里最重要的四个内置角色（硬编码兜底在 `specialist-prompts.ts` 里）：

~~~plaintext
┌──────────────────────────────────────────────────────────────────┐
│ ROUTA（调度者）                                                   │
│                                                                  │
│ 核心行为：规划 → 写 Spec → 停下等确认 → 委派 → 验证              │
│ 硬规则：                                                         │
│   · 不直接写代码                                                  │
│   · 用 @@@task 块定义任务                                         │
│   · 波次 + 验证（delegate wave → END TURN → wait → GATE verify） │
│   · 可用工具：delegate_task, set_note_content, read_note, ...    │
│                                                                  │
│ 一句话：项目经理——规划、派活、不亲自动手                          │
├──────────────────────────────────────────────────────────────────┤
│ CRAFTER（工匠）                                                   │
│                                                                  │
│ 核心行为：只实现分配给自己的那一个任务                             │
│ 硬规则：                                                         │
│   · 不做范围之外的重构                                            │
│   · 不委派给别人                                                  │
│   · 最后必须调 report_to_parent（Parent 被阻塞等着）              │
│   · 汇报内容：summary, success, filesModified, taskId            │
│                                                                  │
│ 一句话：螺丝钉——干完自己那份活，报告，走人                       │
├──────────────────────────────────────────────────────────────────┤
│ GATE（质检员）                                                    │
│                                                                  │
│ 核心行为：基于证据验证，不靠猜测                                   │
│ 硬规则：                                                         │
│   · 只按 Acceptance Criteria 逐条检查                             │
│   · 标记 ✅ VERIFIED / ⚠️ DEVIATION / ❌ MISSING                 │
│   · 只有全部 ✅ 才给 APPROVED                                     │
│   · 调 report_to_parent 带 verdict                                │
│                                                                  │
│ 一句话：只看证据，不讲情面                                        │
├──────────────────────────────────────────────────────────────────┤
│ DEVELOPER（全栈）                                                 │
│                                                                  │
│ 核心行为：自己规划 + 自己实现 + 自己验证                          │
│ 硬规则：                                                         │
│   · 先写 Spec，停下等确认                                         │
│   · 不委派（独狼模式）                                            │
│   · 自己跑验证                                                    │
│                                                                  │
│ 一句话：一个人包揽从规划到交付的全流程                             │
└──────────────────────────────────────────────────────────────────┘
~~~

## 5. 从文件到 ACP 会话：完整注入链路

~~~plaintext
① 需要一个 specialist
   （Kanban: 列配了 specialistId="crafter"）
   （Sessions: ROUTA 调 delegate_task(specialist="CRAFTER")）
   │
   ▼
② 四层优先级查找
   loadSpecialistsFromAllSources(locale = "zh-CN")
   → DB(100) → UserFiles(75) → Bundled(50) → Hardcoded(25)
   │
   ▼
③ 字段解析（优先级：execution.* > frontmatter.* > 默认值）
   │
   ▼
④ 组装 SpecialistConfig
   {
     id: "crafter",
     name: "Crafter",
     role: "CRAFTER",
     defaultModelTier: "smart",
     systemPrompt: "你是一个工匠...(几百行)",
     roleReminder: "只做分配的任务，不做范围外的事",
     source: "bundled",
     locale: "zh-CN",
     defaultProvider: "claude",
   }
   │
   ▼
⑤ 注入 ACP 会话

   Sessions/Team 模式：
     buildDelegationPrompt(specialist, task, agentId)
       = specialist.systemPrompt + 任务上下文 + agentId + roleReminder
       → 作为子 Agent 的第一条消息发送

   Kanban 模式：
     buildCoordinatorPrompt(specialist)
       = specialist.systemPrompt（作为 coordinator 的系统 prompt）
     + buildTaskPrompt(task, boardColumns)
       = 结构化工作包（前几篇讲过的那个 prompt）
       → 两段拼接后发送给 ACP 会话
   │
   ▼
⑥ Agent CLI 进程收到 system prompt + task prompt
   → 按 specialist 的行为指令开始工作
   → 同一个 Claude Code CLI，因为 system prompt 不同，
     表现出 CRAFTER / GATE / ROUTA 完全不同的行为
~~~

## 6. 源码导航表

| 模块 | 文件 | 职责 |
|---|---|---|
| ADR | `docs/adr/0005-specialist-externalization.md` | 设计决策："为什么外部化" |
| 类型定义 | `src/core/specialists/specialist-types.ts` | `SpecialistConfig` 接口 |
| 文件加载器 | `src/core/specialists/specialist-file-loader.ts` | 文件系统加载 + locale overlay |
| DB 加载器 | `src/core/specialists/specialist-db-loader.ts` | 四层优先级合并 |
| 硬编码回退 | `src/core/orchestration/specialist-prompts.ts` | 2000+ 行的 ROUTA/CRAFTER/GATE/DEV 系统 prompt |
| Prompt 拼接 | `specialist-prompts.ts` 里的 `buildDelegationPrompt()` / `buildCoordinatorPrompt()` | 把 specialist + task 上下文拼成最终 prompt |
| 内置 specialist 文件 | `resources/specialists/tools/*.yaml` | 随 Routa 发布的默认角色定义 |
| 中文 locale | `resources/specialists/locales/zh-CN/tools/*.yaml` | 中文覆盖版 |
| 用户自定义 | `~/.routa/specialists/*.yaml` | 用户级覆盖 |

## 7. 三个设计洞察

### 洞察 1：Specialist 是"可热插拔的 Agent 灵魂"

同一个 Claude Code CLI 进程，给它不同的 `system_prompt`，
它就变成不同的角色。这就像同一个演员，换一个剧本就演另一个角色。
**Specialist 文件就是剧本。**

这意味着：
- 加新角色 = 加一个 YAML 文件，不改代码
- 改角色行为 = 改 YAML 里的 `system_prompt`，不改代码
- 用户自定义角色 = 在 `~/.routa/specialists/` 放一个文件

### 洞察 2：四层优先级链保证了"怎么都不会崩"

即使文件系统损坏、数据库连不上，硬编码的 2000+ 行 prompt 兜底
保证 ROUTA / CRAFTER / GATE / DEVELOPER 四个核心角色永远可用。
这是防御性设计——系统的核心功能不依赖任何外部资源。

### 洞察 3：Locale overlay 是"同文件覆盖"而非"翻译系统"

Routa 的多语言不是 i18n key-value 翻译，而是**文件级覆盖**——
中文版的 specialist 是一个完整的 YAML 文件，完全替换英文版的对应字段。
这意味着中文版的 `system_prompt` 可以和英文版完全不同，
不只是翻译，还可以包含不同的行为指令（比如"保持中文输出"）。

## 延伸阅读

- [ADR-0005: Specialist Externalization](../adr/0005-specialist-externalization.md) — 设计决策
- [三种模式对比](04-three-modes-compared.zh-CN.md) — Specialist 在三种模式里怎么被使用
- [Agent 触发与 ACP 桥梁](03-agent-trigger-and-acp-bridge.zh-CN.md) — Specialist prompt 怎么注入 ACP
- [系统骨架导览](01-routa-architecture-tour.zh-CN.md) — 全景地图
