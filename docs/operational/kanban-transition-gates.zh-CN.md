# 看板转换门禁

Routa 在 `KanbanColumnAutomation` 上支持通用转换门禁。这些门禁是平台级泳道转换检查，不是项目专属发布策略。

## 字段

```yaml
automation:
  requiredChecklist:
    - browser smoke
    - release evidence
  requiredHumanApproval: true
  validatorCommand: npm test -- --run smoke
  gateMode: blocking
```

- `requiredChecklist`: 要求任务文本或证据中存在匹配的已勾选 Markdown 项，例如 `- [x] browser smoke`。
- `requiredHumanApproval`: 要求任务验证结论为 `APPROVED`。
- `validatorCommand`: 声明式证据门禁。Routa 不会在转换时执行任意 shell；它只检查配置的命令是否出现在验证证据中，并且结果为 `passed`、`success`、`ok` 或 `green` 等通过状态。
- `gateMode`: `blocking` 会在门禁未满足时拒绝转换；`warning` 会允许转换，并向任务评论流写入审计警告。

## 执行路径

- Next.js 任务路由：`PATCH /api/tasks/:taskId`
- Kanban MCP/native tool：`move_card`
- Rust core Kanban RPC：`move_card`
- 看板自动化提示词：会告知 Agent 在调用 `move_card` 前必须满足哪些转换门禁。
- 看板设置 UI：泳道自动化设置可以配置 checklist、人工批准、validator evidence，以及 blocking/warning 模式。

## 边界

- 转换门禁补充现有的 artifact、story-readiness、canonical contract 和 delivery gates。
- `validatorCommand` 有意设计为基于证据。执行命令属于 Agent/session 或项目专属 validator workflow 的职责，不属于 transition API。
- 项目专属发布门禁应该配置在看板列字段上，或叠加自己的 validators；不应该硬编码到 Routa core 中。
