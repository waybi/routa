# 工具调用参数增量压缩（Tool Call Parameter Delta Compaction）

## 问题

ACP Provider 流在工具输入 JSON 对象仍在组装过程中时，可能会发出大量 `tool_call_params_delta` 通知。在每个流式增量上都持久化整个累积的 JSON 和已解析的输入，会让大型工具输入（例如看板的 `update_card` 负载）产生近乎二次方的存储增长。

会话处于活动状态时，运行时 UI 可能仍需要完整的内存流，但对于这些中间增量，持久化存储只需要紧凑的回放元数据。

## 哪些内容会被压缩

对于已持久化的 `tool_call_params_delta` 通知，Routa 现在保留：

- `sessionUpdate`
- 工具标识字段，例如 `toolCallId`、`toolName`、`name`、`kind`、`title`
- 截断后的 `partialJson` 预览
- `partialJsonBytes`
- `accumulatedJsonBytes`
- `parsedInputKeys`
- `compacted: true`
- `compactionReason: "tool_call_params_delta_persistence"`

对于这些中间增量，Routa 不会持久化重复的完整 `accumulatedJson` 或完整 `parsedInput`。

## 历史数据清理

在执行清理之前，请务必先停止 Routa 进程或进行数据库备份。

试运行（Dry-run）：

```bash
npm run db:compact:tool-deltas -- --db routa.db
```

应用 JSON 压缩：

```bash
npm run db:compact:tool-deltas -- --db routa.db --apply
```

应用压缩并对 SQLite 文件进行物理收缩：

```bash
npm run db:compact:tool-deltas -- --db routa.db --apply --vacuum
```

只有执行 `VACUUM`，SQLite 才会把回收的页面返还给文件系统。否则，行负载会变小，但 `.db` 文件可能仍然很大。

## 安全注意事项

- 试运行（Dry-run）是默认行为。
- 除非同时存在 `--apply`，否则 `--vacuum` 会被拒绝。
- 无效的 JSON 行会被跳过，并在输出中计数。
- 该工具会同时压缩 `session_messages.payload` 以及存储在 `acp_sessions.message_history` 中的旧版快照。
