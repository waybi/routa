# 卡片详情新增「人话版」Tab：读取时生成人类可读摘要

状态：已实现（2026-09-21）；生成时机取选项 A（打开 Tab 按需生成 + 缓存）
日期：2026-09-21
来源：分析 RunAI Coder 回答风格后的移植方案讨论（DSH 会话「分析 RunAI Coder 回答风格」）

## 要解决的问题

卡片描述（`tasks.objective`）主要给 agent 看：canonical YAML 机器契约、按轮次追加的过程日志（"第二轮 Backlog 梳理""Todo Entry Gate 第一轮退回"）、满屏 inline code 和裸 UUID 引用。人读非常吃力。

难读的根源不是文笔，而是一个字段塞了三种读者的内容：机器契约、过程日志、人类故事。

## 已否决的替代方案

三层改造（描述字段通道分离 + 文风片段注入全部 11 个 lane specialist + 门禁 lint）。否决原因：

- `todo-orchestrator.yaml:32` 要求退回意见写进描述，且 dev 的 entry gate 从描述章节取证——改通道必须同步改两个 gate 的取证来源，风险大；
- 文风规则要在 11 个 specialist 提示词里维护（zh/en 双份 locale overlay），维护成本高。

新增 Tab 方案零破坏：机器契约、门禁、lane specialist 提示词全部不动；文风规则集中到一个总结器提示词。

局限（明示）：只解决"人读吃力"，不解决描述字段膨胀和下游 agent 的 token 负担。若日后需要治本，另开通道分离方案，与本方案不冲突。

## 必须保持不变的约束

- 不修改描述字段的任何写入行为、canonical YAML 契约（`resources/specialists/workflows/kanban/backlog-refiner.yaml`）。
- 不改 entry/exit gate 与 `src/core/kanban/task-description-write-guard.ts`（dev/review/blocked/done 冻结逻辑）。
- 不改任何 lane specialist 提示词。
- 摘要只读，不提供人工编辑（避免被重新生成覆盖）。

## 方案设计

在卡片详情新增「人话版」Tab（tab 定义位于
`src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx` 的
`KanbanDetailTabId` union，约 L78；tab 列表约 L332）。

内容分两层：

1. **确定性渲染打底**（无 LLM、无失真、即时）：解析描述中的 canonical YAML 与已知章节，渲染标题、AC 表格、当前泳道、阻塞状态。
2. **LLM 人话摘要**（按需生成 + 缓存）：以描述内容 hash 为缓存键；描述未变则永不重复生成。

摘要固定四段版式：

- 这张卡要做什么（一句话）
- 现在到哪一步
- 卡在哪 / 下一步谁做什么
- 证据在哪（链接列表，链接回描述原文或证据 Tab，供一键核对）

总结器提示词集中承载全部文风规则（移植自 RunAI Coder base instructions 的 Writing style 节）：

- 结论先行，三句话概览；
- 中文 AI 腔黑名单：值得注意的是 / 综上所述 / 总的来说 / "不是分歧"式 X-not-Y 对比句；
- 术语与 UUID 首次出现给一句大白话解释；
- 禁止按轮次记流水账（"第 N 轮…"），只呈现最新状态；
- 证据按可验证性排序，不按时间顺序。

新鲜度与信任：

- 摘要带生成时间 + 基于的描述版本 hash；
- 描述在生成后变更 → 显示「内容可能过时」角标 + 重新生成按钮。

## 待拍板决策

生成时机二选一（默认取 A，体验不佳再升级 B）：

| 选项 | 优点 | 代价 |
|---|---|---|
| A. 打开 Tab 按需生成 + 缓存 | 成本最低，旧卡即用 | 首次打开等待数秒 |
| B. lane 流转时自动刷新 | 打开秒出 | 每次流转一次 LLM 调用，需改 automation 步骤 |

## 实现步骤（实现时细化）

1. `KanbanDetailTabId` 增加 `humanReadable`，tab 列表与 i18n（`src/i18n/locales/zh.ts` / `zh-extended.ts`）补文案。
2. 确定性渲染组件：复用现有 YAML/章节解析逻辑（故事就绪度 Tab 已解析 canonical YAML，优先复用其数据源）。
3. 摘要生成端点 + 缓存表（键：taskId + 描述 hash；值：摘要、生成时间、模型）。
4. 总结器提示词（zh/en），含固定四段版式与黑名单规则。
5. 过时角标与重新生成按钮。
6. 黑名单词 lint 作为摘要产物的后置校验（生成后检查，命中则重试一次）。

## 验收标准

- AC1：卡片详情出现「人话版」Tab，确定性渲染部分 1 秒内可见（标题/AC/泳道/阻塞）。
- AC2：LLM 摘要按固定四段版式生成；同一描述内容重复打开不触发第二次 LLM 调用（hash 缓存命中）。
- AC3：描述变更后打开 Tab 显示「可能过时」角标；点重新生成后摘要与缓存键同步更新。
- AC4：摘要产物经黑名单词检查零命中（值得注意的是/综上所述/第 N 轮 等）。
- AC5：存量老卡（无任何新字段）打开人话版 Tab 同样可用。

## 验证方式

- 组件测试跟随 `src/app/workspace/[workspaceId]/kanban/__tests__/` 现有模式（kanban-tab-detail-and-prompts.test.tsx）。
- 用本工作区一张真实的重度 agent 卡（如「错误路径复走查：转发降级与入口按钮落地后补测场景」）做前后可读性对照。

## 实现记录（2026-09-21）

| 步骤 | 落点 |
|---|---|
| Tab + i18n | `src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx`（`humanReadable` 排在概览之后）；`src/i18n/locales/{zh,en}-extended.ts` + `src/i18n/types-extended.ts` 的 `kanbanDetail.humanReadable*` |
| 确定性渲染 | `src/core/kanban/task-human-summary.ts` `extractTaskHumanSummaryFacts`（复用 `parseCanonicalStory`，浏览器可直接调用，无 LLM） |
| 摘要端点 + 缓存 | `src/app/api/tasks/[taskId]/human-summary/route.ts`（GET 只读缓存 / POST 命中则返回、否则生成）；缓存为文件 `~/.routa/task-summaries/<taskId>.<lang>.json`（`ROUTA_TASK_SUMMARY_DIR` 可覆盖），键=描述 sha256，不改任务表 |
| 总结器提示词 | `buildTaskHumanSummaryPrompt`（zh/en 各一份文风规则，固定四段 JSON 版式） |
| 过时角标 / 重新生成 | `src/app/workspace/[workspaceId]/kanban/kanban-human-readable-panel.tsx`（hash 不一致显示角标，不自动重生成；按钮 `force:true`） |
| 黑名单 lint | `lintTaskHumanSummary` + `generateTaskHumanSummary` 命中即带反馈重试一次；`evidence[].where` 豁免（它是定位器，允许原样引用「第二轮…」章节标题） |

模型调用复用 `resolveWorkspaceAgentConfig` + `createLanguageModel`（`WORKSPACE_AGENT_PROVIDER` / `WORKSPACE_AGENT_MODEL`），单次 `generateText`，不带工具。

验收结果（本机 dev server + 卡 `c5320340`，`claude-sonnet-4-5`）：AC1 事实层随渲染即出；AC2 首次 POST 47.9s 生成、二次 POST 27ms 命中缓存；AC3 篡改缓存 hash 后 GET 返回 `stale:true`；AC4 生成产物 `lintHits: []`；AC5 组件测试覆盖纯文本老卡。

未做：Rust/Axum 侧（`crates/routa-server`）没有对应端点，桌面静态运行时打开该 Tab 会得到生成失败提示；需要时另开卡补齐。
