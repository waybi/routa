---
title: "team run 委派子 agent 时 cwd 未绑定到选中仓库,子 agent 跑错仓库"
date: "2026-08-13"
kind: issue
status: resolved
severity: high
area: orchestration
tags: [team-run, delegation, cwd, mcp, repo-context]
reported_by: "claude"
related_issues: []
github_issue: null
github_state: null
github_url: null
---

# team run 委派子 agent 时 cwd 未绑定到选中仓库

## What Happened

在团队页 `/workspace/default/team` 发起 team run,明确选择了外部仓库 linqu(`/Users/ouweibing/Desktop/my/linqu`)与分支 `experiment/wave1-store-rerun-kb`。协调者(Agent Lead,provider `cc-haha`)启动后调用 MCP 工具派工,实际传入的参数为:

```json
{
  "taskId": "f436b9e0-05fe-4d14-b23c-9ee588168f02",
  "callerAgentId": "38ec1ebb-91dc-44ea-b781-152c62e07ee6",
  "specialist": "CRAFTER",
  "cwd": "/Users/ouweibing/Desktop/my/routa",
  "waitMode": "immediate"
}
```

`cwd` 指向 routa 自身,而非选中的 linqu。子 agent 因此在 routa 仓库中执行,任务书要求精读的 `docs/engineering/design-doc.md`(仅存在于 linqu)在 routa 中不存在,子 agent 无法读到设计依据,也不会在 linqu 产出任何代码。

运行约 9 分钟后:Agent Lead 状态 WORKING,其余成员 IDLE,任务笔记与交付物均为空,linqu 工作树 0 变更。

## Expected Behavior

team run 创建时已选定仓库路径与分支,该上下文应作为权威信息贯穿到子 agent 的 spawn:子 agent 的工作目录应位于选中仓库(linqu)内,而不应回退到服务进程自身的 cwd。协调者不应需要"猜"仓库路径。

## Reproduction Context

- Environment: web(`npm run dev`,localhost:3000)
- Trigger: 团队页选择一个**外部**仓库(非 routa 自身)+ 分支,填写任务书并发送,协调者派工给 CRAFTER

步骤:
1. 打开 `/workspace/default/team`
2. 选择仓库 linqu(`/Users/ouweibing/Desktop/my/linqu`),分支选 `experiment/wave1-store-rerun-kb`
3. Provider 选 Claude Code Haha(cc-haha)
4. 提交一份要求子 agent 读取 linqu 内文档的任务书
5. 观察协调者 `delegate_task_to_agent` 调用参数中的 `cwd`,以及 linqu 工作树是否有产出

## Why This Might Happen

- `delegate_task_to_agent` 的 `cwd` 在 inputSchema 中仅描述为 "Working directory",无默认值、无仓库约束,完全依赖协调者自行填写;协调者可获知的最直接路径是它自己进程的 cwd,疑似因此填成了 routa。
- 解析 cwd 时可能没有任何来自 session/team run 的仓库上下文参与:`orchestrator.ts:551` 为 `const cwd = params.cwd ?? this.config.defaultCwd`,兜底的 `defaultCwd` 在 `orchestrator-singleton.ts:1909` 回退为 `process.cwd()`(即 dev server 所在的 routa)。两条路径都不指向选中仓库。
- 前端似乎存在 `sessionContext?: { cwd?: string; branch?: string; repoName?: string }` 形状的仓库上下文(team-page-client.tsx 附近),但该上下文可能未被传递/未被 delegate 链路消费,疑似在到达 orchestrator 之前即断链。
- 另有 `orchestrator.ts:2479` 存在同样的 `params.cwd ?? this.config.defaultCwd` 模式,可能是同类问题的第二处。
- 由于缺少"cwd 必须落在选中仓库内"的校验,填错不会报错,只会静默地在错误仓库里工作,失败表现为"长时间无产出"而非显式错误,较难定位。

## Relevant Files

- `src/core/orchestration/orchestrator.ts`(:551、:2479 cwd 解析;:496 `delegateTaskWithSpawn`)
- `src/core/orchestration/orchestrator-singleton.ts`(:1909 `defaultCwd` 回退到 `process.cwd()`)
- `src/core/mcp/mcp-tool-executor.ts`(:882 `delegate_task_to_agent` schema;:433 cwd 透传;:853 `create_task`)
- `src/app/workspace/[workspaceId]/team/team-page-client.tsx`(仓库/分支选择与 sessionContext)

## Observations

协调者会话 transcript:`~/.claude/projects/-Users-ouweibing-Desktop-my-routa/97356b1c-ade5-4040-b74e-420983f34367.jsonl`

其工具调用序列为 `ToolSearch` → `list_agents` → `create_task` → `delegate_task_to_agent`,共 4 次,其中 delegate 的返回:

```json
{"agentId":"78032201-2c98-4e3f-be8f-1b252e6eac6b",
 "agentName":"crafter-研究-·-store-层(l0-数据访问端口)端口清单与契约",
 "specialist":"crafter","provider":"cc-haha",
 "sessionId":"7adafa22-6583-45c8-9e75-e38151d0f7f0","waitMode":"immediate"}
```

协调者产出的任务书本身质量正常(要求逐字精读文档、标注出处、禁止凭印象),问题不在任务书,而在执行目录。

补充:分支语义也可能存在同类缺口——即使 cwd 修正到 linqu,当前未见机制保证子 agent 工作树处于 session 选定的分支上。建议单独跟踪。

## Resolution

根因确认:`delegateTaskWithSpawn` 内部对同一次委派使用了两套 cwd 标准——父记忆写入走 `resolveSessionCwd(callerSessionId, cwd)`(session 权威,正确落在 linqu),而子 agent spawn 走 `params.cwd ?? this.config.defaultCwd`(协调者自填,落在 routa)。session 记录本身是正确的,`GET /api/sessions?surface=team` 显示 `cwd=/Users/ouweibing/Desktop/my/linqu`、`branch=experiment/wave1-store-rerun-kb`,信息在 delegate 环节才被丢弃。

修复:新增 `resolveDelegationCwd(callerSessionId, requestedCwd)`,以 caller session 的仓库为权威边界:

- session 有 cwd 且调用方未指定 → 用 session cwd
- 调用方指定的路径位于 session 仓库内(含仓库根自身)→ 保留该路径,支持 monorepo 子目录
- 调用方指定的路径逸出 session 仓库 → 回退到 session cwd,不再静默跑错仓库
- session 无 cwd(如未知会话)→ 维持既有 `requestedCwd ?? defaultCwd` 行为

`delegateTaskWithSpawn` 的 cwd 解析改为调用该函数。由于同一 `cwd` 变量还供 TraceReader 与 learned playbook 使用,这些也一并对齐到选中仓库。

变更文件:
- `src/core/orchestration/orchestrator.ts`(新增 `resolveDelegationCwd`;委派处改用之)
- `src/core/orchestration/__tests__/orchestrator.test.ts`(新增两条特征测试:逸出路径被收敛、仓库内子目录被保留;既有 "child runs elsewhere" 用例按新语义改为子目录场景)

验证:`orchestration` + `mcp` 测试 57 passed,`tsc --noEmit` 0 error。

遗留:分支语义未处理——即使 cwd 正确,当前仍不保证子 agent 工作树处于 session 选定分支。已在 Observations 中记录,建议单独跟踪。

## References

- 实验背景:用接入知识库的 team 重做 linqu Wave 1 Store 层,与 baseline(linqu commit `d146b53`、`e63ce11`)做质量对照。本 bug 导致该次实验未产生任何产出。
