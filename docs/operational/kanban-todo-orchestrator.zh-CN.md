# Todo 编排员（kanban-todo-orchestrator）说明

Todo 编排员是 Kanban 看板 Todo 列的岗位。它复核 Backlog 产出的 story，通过后先读经验包、再搜知识库，然后在卡片上追加执行计划、关键文件、依赖计划和风险提示，最后把卡推进到 Dev。

## 岗位信息

| 项目 | 内容 |
|---|---|
| ID | `kanban-todo-orchestrator` |
| 中文名 | Todo 编排员 |
| 英文名 | Todo Orchestrator |
| Role | `CRAFTER` |
| Model Tier | `smart` |
| 源文件（默认） | `resources/specialists/workflows/kanban/todo-orchestrator.yaml` |
| 源文件（中文） | `resources/specialists/locales/zh-CN/workflows/kanban/todo-orchestrator.yaml` |
| 源文件（英文） | `resources/specialists/locales/en/workflows/kanban/todo-orchestrator.yaml` |

默认 locale 是 en，加载器给 en 读根目录的 `resources/specialists/workflows/kanban/*.yaml`，`locales/en` 只是覆盖候选；看板步骤带 `specialistLocale: zh-CN` 时读 `locales/zh-CN`。所以改提示词时三份文件要一起改。三份文件的关键句由 `src/core/specialists/__tests__/kanban-todo-review-prompts.test.ts` 锁定。

岗位目录页由 `npm run docs:specialists:generate` 生成到 `docs/specialists/`。该目录被 `.gitignore` 忽略，不入库。

## 写计划前的两步

```text
Entry Gate 通过 → 读经验包 → 搜知识库 → 写 Execution Plan / Key Files / Dependency Plan / Risk Notes → move_card 到 dev
```

### 第一步：读经验包

经验包是老板按主题整理的踩坑记录，放在 `/Users/ouweibing/Desktop/topgames_work/Vault/项目索引/经验包/<包>.md`。同目录的 `triggers.json` 的 `packs` 键列出每个包和关键词。每张卡都要读，纯文档和配置卡也一样。

先按卡的仓库定包：

| 卡的仓库 | 经验包 |
|---|---|
| routa | routa |
| deepseek-harness | dsh-config |
| turnilo | turnilo |
| TopBI（topbi / plywood_go） | topbi |
| local-tools | 按工具主题：网关 → gateway；DSH 插件/补丁/配置 → dsh-config；DS Bot → ds-bot |

再按卡片标题和描述里的词，对照 `triggers.json` 的关键词补包。

读法：先跑 `grep -n '^## ' <包>.md` 看条目标题，再按行号只读相关条目。

写进 Risk Notes 的固定格式：

| 情况 | 中文卡 | 英文卡 |
|---|---|---|
| 有相关条目 | 条目要点 + `（经验包 <包>:<行号>）` | 条目要点 + `(pack <pack>:<line>)` |
| 没有相关条目 | `经验包 <包>：已看标题，无相关条目` | `Pack <pack>: titles checked, no relevant entries` |

Vault 只读，不改任何 Vault 文件，包括 `triggers.json` 和经验包本身。

### 第二步：搜知识库

检索命令：`python3 /Users/ouweibing/Desktop/topgames_work/Vault/distill/_index/search.py "<关键词>" -k 5 --json`。

每张卡都要检索，不再因为是纯文档或配置卡而跳过。结果都不相关时，在 Risk Notes 写一行：

- 中文卡：`知识库：查了 <关键词>，无相关条目`
- 英文卡：`Knowledge base: searched <keywords>, no relevant entries`

三份提示词都同时写了中英两种固定行。原因是根文件是英文提示词，中文卡也会走它；只写英文行会让中文卡的 Risk Notes 混进英文。

## 为什么这样改

| 复盘 | 现象 | 改法 |
|---|---|---|
| L204 | 编排员只在经验包提示命中时才读。卡 82e9f2ae（deepseek-web 网关 README）该读 gateway 没读；卡 1b7058a0 该读 dsh-config 和 gateway 也没读 | 新增「读经验包」一节，按仓库和主题定包，每张卡都读，读完必须留痕 |
| L232 | 原提示词写着「纯文档、配置变更这类简单任务可以跳过这一步」，卡 82e9f2ae、2e22601c 因此没搜知识库 | 删掉跳过句，改成一律检索，无结果也写固定行 |

## 变更记录

| 日期 | 改了什么 | 对应复盘 | 提交号 |
|---|---|---|---|
| 2026-10-21 | 新增「读经验包（写计划之前）」一节和仓库→包映射；删掉知识库跳过句，改为一律检索；新增 Risk Notes 固定行；新增三路径提示词单测 | L204/L232 | 见本提交 |
