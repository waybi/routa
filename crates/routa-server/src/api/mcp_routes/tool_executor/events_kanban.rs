use crate::state::AppState;

use super::{rpc_tool_result, tool_result_error, tool_result_json};

fn required_str_arg<'a>(
    args: &'a serde_json::Value,
    key: &str,
) -> Result<&'a str, serde_json::Value> {
    match args.get(key).and_then(|value| value.as_str()) {
        Some(value) if !value.trim().is_empty() => Ok(value),
        _ => Err(tool_result_error(&format!(
            "Missing required argument: {key}"
        ))),
    }
}

/// Fields `update_card` can change, in the order reported back to the agent.
/// Mirrors the Next implementation in `src/core/tools/kanban-tools.ts`.
const UPDATE_CARD_FIELDS: [&str; 5] = ["title", "description", "comment", "priority", "labels"];

/// Project the `update_card` RPC result into a lightweight ack.
///
/// Write tools must not echo the card back to the agent: card comments are
/// append-only, so echoing re-injects the whole accumulated comment history
/// into the calling agent's LLM context on every write (measured at 76 KB /
/// ~20K tokens per call on a comment-heavy card). Agents that need fresh state
/// call `get_task`.
///
/// The RPC itself keeps returning the full card because the CLI
/// (`crates/routa-cli/src/commands/kanban.rs`) renders it; only this MCP
/// projection is trimmed. Shape is mirrored by `taskToUpdateAck` in
/// `src/core/tools/kanban-tools.ts`.
fn update_card_ack(result: &serde_json::Value, args: &serde_json::Value) -> serde_json::Value {
    let card = result.get("card");
    let updated_fields: Vec<&str> = UPDATE_CARD_FIELDS
        .iter()
        .copied()
        .filter(|field| !matches!(args.get(*field), None | Some(serde_json::Value::Null)))
        .collect();

    serde_json::json!({
        "id": card.and_then(|card| card.get("id")).cloned().unwrap_or(serde_json::Value::Null),
        "updatedFields": updated_fields,
        "updatedAt": card.and_then(|card| card.get("updatedAt")).cloned().unwrap_or(serde_json::Value::Null),
    })
}

/// Project the `move_card` RPC result into a lightweight ack.
/// See [`update_card_ack`] for rationale; mirrors `taskToMoveAck` in
/// `src/core/tools/kanban-tools.ts`.
fn move_card_ack(result: &serde_json::Value) -> serde_json::Value {
    let card = result.get("card");
    let field = |key: &str| {
        card.and_then(|card| card.get(key))
            .cloned()
            .unwrap_or(serde_json::Value::Null)
    };

    serde_json::json!({
        "id": field("id"),
        "columnId": field("columnId"),
        "position": field("position"),
        "status": field("status"),
    })
}

pub(super) async fn execute(
    state: &AppState,
    name: &str,
    args: &serde_json::Value,
    workspace_id: &str,
) -> Option<serde_json::Value> {
    let result = match name {
        "subscribe_to_events" => {
            let agent_id = args.get("agentId").and_then(|v| v.as_str()).unwrap_or("");
            let agent_name = args.get("agentName").and_then(|v| v.as_str()).unwrap_or("");
            let event_types: Vec<crate::events::AgentEventType> = args
                .get("eventTypes")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str())
                        .filter_map(crate::events::AgentEventType::from_str)
                        .collect()
                })
                .unwrap_or_default();

            let subscription_id = uuid::Uuid::new_v4().to_string();
            let subscription = crate::events::EventSubscription {
                id: subscription_id.clone(),
                agent_id: agent_id.to_string(),
                agent_name: agent_name.to_string(),
                event_types,
                exclude_self: true,
                one_shot: false,
                wait_group_id: None,
                priority: 0,
            };
            state.event_bus.subscribe(subscription).await;

            tool_result_json(&serde_json::json!({
                "success": true,
                "subscriptionId": subscription_id
            }))
        }
        "unsubscribe_from_events" => {
            let subscription_id = args
                .get("subscriptionId")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            state.event_bus.unsubscribe(subscription_id).await;
            tool_result_json(&serde_json::json!({
                "success": true,
                "subscriptionId": subscription_id
            }))
        }
        "create_board" => match rpc_tool_result(
            state,
            "kanban.createBoard",
            serde_json::json!({
                "workspaceId": workspace_id,
                "name": args.get("name").and_then(|v| v.as_str()).unwrap_or("Board"),
                "columns": args.get("columns").cloned(),
            }),
        )
        .await
        {
            Ok(result) => {
                let board = result.get("board").cloned().unwrap_or_default();
                let columns = board
                    .get("columns")
                    .and_then(|value| value.as_array())
                    .cloned()
                    .unwrap_or_default()
                    .into_iter()
                    .map(|column| {
                        serde_json::json!({
                            "id": column.get("id").cloned().unwrap_or_default(),
                            "name": column.get("name").cloned().unwrap_or_default()
                        })
                    })
                    .collect::<Vec<_>>();
                tool_result_json(&serde_json::json!({
                    "boardId": board.get("id").cloned().unwrap_or_default(),
                    "name": board.get("name").cloned().unwrap_or_default(),
                    "columns": columns
                }))
            }
            Err(error) => tool_result_error(&error),
        },
        "list_boards" => match rpc_tool_result(
            state,
            "kanban.listBoards",
            serde_json::json!({ "workspaceId": workspace_id }),
        )
        .await
        {
            Ok(result) => {
                let boards = result
                    .get("boards")
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!([]));
                tool_result_json(&boards)
            }
            Err(error) => tool_result_error(&error),
        },
        "get_board" => match rpc_tool_result(
            state,
            "kanban.getBoard",
            serde_json::json!({
                "boardId": args.get("boardId").and_then(|v| v.as_str()).unwrap_or("")
            }),
        )
        .await
        {
            Ok(result) => tool_result_json(&result),
            Err(error) => tool_result_error(&error),
        },
        "create_card" => match rpc_tool_result(
            state,
            "kanban.createCard",
            serde_json::json!({
                "workspaceId": workspace_id,
                "boardId": args.get("boardId").cloned(),
                "columnId": args.get("columnId").cloned(),
                "title": args.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                "description": args.get("description").cloned(),
                "priority": args.get("priority").cloned(),
                "labels": args.get("labels").cloned(),
            }),
        )
        .await
        {
            Ok(result) => {
                let card = result
                    .get("card")
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!({}));
                tool_result_json(&card)
            }
            Err(error) => tool_result_error(&error),
        },
        "move_card" => match rpc_tool_result(
            state,
            "kanban.moveCard",
            serde_json::json!({
                "cardId": args.get("cardId").and_then(|v| v.as_str()).unwrap_or(""),
                "targetColumnId": args.get("targetColumnId").and_then(|v| v.as_str()).unwrap_or(""),
                "position": args.get("position").cloned(),
            }),
        )
        .await
        {
            Ok(result) => tool_result_json(&move_card_ack(&result)),
            Err(error) => tool_result_error(&error),
        },
        "update_card" => match rpc_tool_result(
            state,
            "kanban.updateCard",
            serde_json::json!({
                "cardId": args.get("cardId").and_then(|v| v.as_str()).unwrap_or(""),
                "title": args.get("title").cloned(),
                "description": args.get("description").cloned(),
                "comment": args.get("comment").cloned(),
                "priority": args.get("priority").cloned(),
                "labels": args.get("labels").cloned(),
            }),
        )
        .await
        {
            Ok(result) => tool_result_json(&update_card_ack(&result, args)),
            Err(error) => tool_result_error(&error),
        },
        "delete_card" => match rpc_tool_result(
            state,
            "kanban.deleteCard",
            serde_json::json!({
                "cardId": args.get("cardId").and_then(|v| v.as_str()).unwrap_or("")
            }),
        )
        .await
        {
            Ok(result) => tool_result_json(&result),
            Err(error) => tool_result_error(&error),
        },
        "create_column" => match rpc_tool_result(
            state,
            "kanban.createColumn",
            serde_json::json!({
                "boardId": args.get("boardId").and_then(|v| v.as_str()).unwrap_or(""),
                "name": args.get("name").and_then(|v| v.as_str()).unwrap_or(""),
                "color": args.get("color").cloned(),
            }),
        )
        .await
        {
            Ok(result) => {
                let board = result.get("board").cloned().unwrap_or_default();
                let column = board
                    .get("columns")
                    .and_then(|value| value.as_array())
                    .and_then(|columns| columns.last())
                    .cloned()
                    .unwrap_or_default();
                tool_result_json(&serde_json::json!({
                    "columnId": column.get("id").cloned().unwrap_or_default(),
                    "name": column.get("name").cloned().unwrap_or_default(),
                    "position": column.get("position").cloned().unwrap_or_default()
                }))
            }
            Err(error) => tool_result_error(&error),
        },
        "delete_column" => match rpc_tool_result(
            state,
            "kanban.deleteColumn",
            serde_json::json!({
                "boardId": args.get("boardId").and_then(|v| v.as_str()).unwrap_or(""),
                "columnId": args.get("columnId").and_then(|v| v.as_str()).unwrap_or(""),
                "deleteCards": args.get("deleteCards").cloned(),
            }),
        )
        .await
        {
            Ok(result) => tool_result_json(&serde_json::json!({
                "deleted": result.get("deleted").cloned().unwrap_or(serde_json::json!(false)),
                "columnId": result.get("columnId").cloned().unwrap_or_default(),
                "cardsDeleted": result.get("cardsDeleted").cloned().unwrap_or(serde_json::json!(0)),
                "cardsMoved": result.get("cardsMoved").cloned().unwrap_or(serde_json::json!(0)),
            })),
            Err(error) => tool_result_error(&error),
        },
        "search_cards" => match rpc_tool_result(
            state,
            "kanban.searchCards",
            serde_json::json!({
                "workspaceId": workspace_id,
                "query": args.get("query").and_then(|v| v.as_str()).unwrap_or(""),
                "boardId": args.get("boardId").cloned(),
            }),
        )
        .await
        {
            Ok(result) => {
                let cards = result
                    .get("cards")
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!([]));
                tool_result_json(&cards)
            }
            Err(error) => tool_result_error(&error),
        },
        "list_cards_by_column" => match rpc_tool_result(
            state,
            "kanban.listCardsByColumn",
            serde_json::json!({
                "workspaceId": workspace_id,
                "columnId": args.get("columnId").and_then(|v| v.as_str()).unwrap_or(""),
                "boardId": args.get("boardId").cloned(),
            }),
        )
        .await
        {
            Ok(result) => tool_result_json(&result),
            Err(error) => tool_result_error(&error),
        },
        "decompose_tasks" => match rpc_tool_result(
            state,
            "kanban.decomposeTasks",
            serde_json::json!({
                "workspaceId": workspace_id,
                "boardId": args.get("boardId").cloned(),
                "columnId": args.get("columnId").cloned(),
                "tasks": args.get("tasks").cloned().unwrap_or_else(|| serde_json::json!([])),
            }),
        )
        .await
        {
            Ok(result) => tool_result_json(&result),
            Err(error) => tool_result_error(&error),
        },
        "request_previous_lane_handoff" => {
            let task_id = match required_str_arg(args, "taskId") {
                Ok(value) => value,
                Err(error) => return Some(error),
            };
            let request_type = match required_str_arg(args, "requestType") {
                Ok(value) => value,
                Err(error) => return Some(error),
            };
            let request = match required_str_arg(args, "request") {
                Ok(value) => value,
                Err(error) => return Some(error),
            };
            let session_id = match required_str_arg(args, "sessionId") {
                Ok(value) => value,
                Err(error) => return Some(error),
            };
            match rpc_tool_result(
                state,
                "kanban.requestPreviousLaneHandoff",
                serde_json::json!({
                    "taskId": task_id,
                    "requestType": request_type,
                    "request": request,
                    "sessionId": session_id,
                }),
            )
            .await
            {
                Ok(result) => tool_result_json(&result),
                Err(error) => tool_result_error(&error),
            }
        }
        "submit_lane_handoff" => {
            let task_id = match required_str_arg(args, "taskId") {
                Ok(value) => value,
                Err(error) => return Some(error),
            };
            let handoff_id = match required_str_arg(args, "handoffId") {
                Ok(value) => value,
                Err(error) => return Some(error),
            };
            let status = match required_str_arg(args, "status") {
                Ok(value) => value,
                Err(error) => return Some(error),
            };
            let summary = match required_str_arg(args, "summary") {
                Ok(value) => value,
                Err(error) => return Some(error),
            };
            let session_id = match required_str_arg(args, "sessionId") {
                Ok(value) => value,
                Err(error) => return Some(error),
            };
            match rpc_tool_result(
                state,
                "kanban.submitLaneHandoff",
                serde_json::json!({
                    "taskId": task_id,
                    "handoffId": handoff_id,
                    "status": status,
                    "summary": summary,
                    "sessionId": session_id,
                }),
            )
            .await
            {
                Ok(result) => tool_result_json(&result),
                Err(error) => tool_result_error(&error),
            }
        }
        _ => return None,
    };

    Some(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Full card as returned by `kanban.updateCard` / `kanban.moveCard` RPC,
    /// with a comment blob standing in for accumulated review history.
    fn rpc_result_with_fat_card() -> serde_json::Value {
        serde_json::json!({
            "card": {
                "id": "task-ack-1",
                "title": "Comment-heavy card",
                "description": "Stable story body",
                "comment": "prior review note\n\n".repeat(500),
                "status": "IN_PROGRESS",
                "columnId": "dev",
                "position": 3,
                "priority": "high",
                "labels": ["kanban"],
                "createdAt": "2026-09-01T00:00:00Z",
                "updatedAt": "2026-09-21T07:01:08.289Z",
            }
        })
    }

    #[test]
    fn update_card_ack_drops_the_card_payload() {
        let args = serde_json::json!({
            "cardId": "task-ack-1",
            "comment": "New note",
            "priority": "high",
        });

        let ack = update_card_ack(&rpc_result_with_fat_card(), &args);

        assert_eq!(
            ack,
            serde_json::json!({
                "id": "task-ack-1",
                "updatedFields": ["comment", "priority"],
                "updatedAt": "2026-09-21T07:01:08.289Z",
            })
        );

        let serialized = serde_json::to_string(&ack).unwrap();
        assert!(!serialized.contains("prior review note"));
        assert!(serialized.len() < 1024);
    }

    #[test]
    fn update_card_ack_reports_only_supplied_fields() {
        let args = serde_json::json!({
            "cardId": "task-ack-1",
            "title": "Renamed card",
            "labels": ["urgent"],
            "comment": serde_json::Value::Null,
        });

        let ack = update_card_ack(&rpc_result_with_fat_card(), &args);

        assert_eq!(
            ack.get("updatedFields").unwrap(),
            &serde_json::json!(["title", "labels"])
        );
    }

    #[test]
    fn move_card_ack_drops_the_card_payload() {
        let ack = move_card_ack(&rpc_result_with_fat_card());

        assert_eq!(
            ack,
            serde_json::json!({
                "id": "task-ack-1",
                "columnId": "dev",
                "position": 3,
                "status": "IN_PROGRESS",
            })
        );

        let serialized = serde_json::to_string(&ack).unwrap();
        assert!(!serialized.contains("prior review note"));
        assert!(serialized.len() < 1024);
    }

    #[test]
    fn acks_tolerate_a_missing_card_field() {
        let empty = serde_json::json!({});

        let no_fields: Vec<&str> = Vec::new();
        assert_eq!(
            update_card_ack(&empty, &serde_json::json!({})),
            serde_json::json!({
                "id": serde_json::Value::Null,
                "updatedFields": no_fields,
                "updatedAt": serde_json::Value::Null,
            })
        );
        assert_eq!(
            move_card_ack(&empty),
            serde_json::json!({
                "id": serde_json::Value::Null,
                "columnId": serde_json::Value::Null,
                "position": serde_json::Value::Null,
                "status": serde_json::Value::Null,
            })
        );
    }
}
