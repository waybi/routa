//! MCP `get_task`: read-only card snapshot (comments, review verdict, lane
//! step summary).
//!
//! Mirrors `src/core/tools/kanban-task-snapshot.ts`: same top-level and
//! lane-summary key sets, comments oldest first, code-point caps per text, and
//! the reply's pretty-printed JSON (the exact text `tool_result_json` returns)
//! measured in UTF-8 bytes, dropping the oldest comments until it fits. The
//! desktop task store keeps comments only in the legacy `comment` column, so
//! comments are hydrated like `hydrateTaskComments` on the Next side.

use routa_core::models::task::Task;
use serde_json::{json, Value};

use crate::state::AppState;

use super::{tool_result_error, tool_result_json};

pub(super) const DEFAULT_MAX_BYTES: usize = 32_768;
const HARD_MAX_BYTES: usize = 262_144;
const DEFAULT_COMMENT_LIMIT: usize = 20;
const DEFAULT_MAX_COMMENT_CHARS: usize = 1_500;
const DEFAULT_MAX_OBJECTIVE_CHARS: usize = 1_500;
const DEFAULT_MAX_REPORT_CHARS: usize = 3_000;
const MIN_FALLBACK_TEXT_CHARS: usize = 200;

pub(in crate::api::mcp_routes) const GET_TASK_DESCRIPTION: &str = "Read-only: return one card with comments (oldest first), verificationVerdict/verificationReport, acceptanceCriteria, verificationCommands and a lane-step summary. Omit taskId to read the card bound to the current session. Replies stay under 32 KB by default (long texts carry truncated markers); pass commentLimit and maxCommentChars to get more text.";

pub(in crate::api::mcp_routes) fn get_task_input_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "taskId": { "type": "string", "description": "Card/task ID (defaults to the card bound to the current session)" },
            "commentLimit": { "type": "number", "description": "Return at most this many newest comments (default 20)" },
            "maxCommentChars": { "type": "number", "description": "Characters kept per comment, objective and verificationReport (default 1500/1500/3000)" },
            "sessionId": { "type": "string", "description": "Session used to find the bound card when taskId is omitted" },
            "workspaceId": { "type": "string", "description": "Workspace ID (uses default if omitted)" }
        }
    })
}

#[derive(Debug, Default, Clone, Copy)]
pub(super) struct SnapshotOptions {
    pub comment_limit: Option<usize>,
    pub max_comment_chars: Option<usize>,
}

impl SnapshotOptions {
    fn from_args(args: &Value) -> Self {
        let positive = |key: &str| {
            args.get(key)
                .and_then(Value::as_f64)
                .filter(|value| value.is_finite() && *value >= 1.0)
                .map(|value| value.floor() as usize)
        };
        Self {
            comment_limit: positive("commentLimit"),
            max_comment_chars: positive("maxCommentChars"),
        }
    }
}

/// Truncate to `max` Unicode scalar values; returns (text, truncated).
fn truncate_chars(text: &str, max: usize) -> (String, bool) {
    match text.char_indices().nth(max) {
        Some((index, _)) => (text[..index].to_string(), true),
        None => (text.to_string(), false),
    }
}

fn str_or_null(value: Option<&Value>) -> Value {
    value
        .and_then(Value::as_str)
        .map(|text| Value::String(text.to_string()))
        .unwrap_or(Value::Null)
}

fn comment_millis(comment: &Value) -> i64 {
    comment
        .get("createdAt")
        .and_then(Value::as_str)
        .and_then(|text| chrono::DateTime::parse_from_rfc3339(text).ok())
        .map(|time| time.timestamp_millis())
        .unwrap_or(i64::MIN)
}

/// Same records `hydrateTaskComments(comments, comment)` yields on the Next side.
fn hydrate_comments(task: &Value) -> Vec<Value> {
    if let Some(Value::Array(comments)) = task.get("comments") {
        if !comments.is_empty() {
            return comments.clone();
        }
    }
    match task.get("comment").and_then(Value::as_str).map(str::trim) {
        Some(legacy) if !legacy.is_empty() => vec![json!({
            "id": "legacy-comment-1",
            "body": legacy,
            "createdAt": "",
            "source": "legacy_import",
        })],
        _ => Vec::new(),
    }
}

fn summarize_lane_session(lane: &Value) -> Value {
    json!({
        "sessionId": str_or_null(lane.get("sessionId")),
        "stepName": str_or_null(lane.get("stepName")),
        "role": str_or_null(lane.get("role")),
        "status": lane.get("status").cloned().unwrap_or(Value::Null),
        "startedAt": str_or_null(lane.get("startedAt")),
        "completedAt": str_or_null(lane.get("completedAt")),
        "columnId": str_or_null(lane.get("columnId")),
    })
}

fn pretty_bytes(value: &Value) -> usize {
    serde_json::to_string_pretty(value)
        .map(|text| text.len())
        .unwrap_or(usize::MAX)
}

/// Build the snapshot from a serialized (camelCase) task.
pub(super) fn build_task_snapshot(task: &Value, options: SnapshotOptions) -> Value {
    let explicit = options.comment_limit.is_some() || options.max_comment_chars.is_some();
    let max_bytes = if explicit {
        HARD_MAX_BYTES
    } else {
        DEFAULT_MAX_BYTES
    };
    let comment_chars = options
        .max_comment_chars
        .unwrap_or(DEFAULT_MAX_COMMENT_CHARS);
    let comment_limit = options.comment_limit.unwrap_or(DEFAULT_COMMENT_LIMIT);

    let mut sorted = hydrate_comments(task);
    sorted.sort_by_key(comment_millis); // stable: ties keep storage order
    let comments_total = sorted.len();
    let mut comments: Vec<Value> = sorted[comments_total.saturating_sub(comment_limit)..]
        .iter()
        .map(|entry| {
            let (body, truncated) = truncate_chars(
                entry.get("body").and_then(Value::as_str).unwrap_or(""),
                comment_chars,
            );
            let mut comment = json!({
                "id": str_or_null(entry.get("id")),
                "body": body,
                "createdAt": entry.get("createdAt").and_then(Value::as_str).unwrap_or(""),
                "source": str_or_null(entry.get("source")),
                "agentId": str_or_null(entry.get("agentId")),
                "sessionId": str_or_null(entry.get("sessionId")),
            });
            if truncated {
                comment["truncated"] = Value::Bool(true);
            }
            comment
        })
        .collect();

    let string_array = |key: &str| {
        task.get(key)
            .filter(|value| value.is_array())
            .cloned()
            .unwrap_or_else(|| json!([]))
    };
    let lane_sessions: Vec<Value> = task
        .get("laneSessions")
        .and_then(Value::as_array)
        .map(|lanes| lanes.iter().map(summarize_lane_session).collect())
        .unwrap_or_default();
    let build = |comments: &[Value], objective_chars: usize, report_chars: usize| {
        let (objective, objective_truncated) = truncate_chars(
            task.get("objective").and_then(Value::as_str).unwrap_or(""),
            objective_chars,
        );
        let report = task
            .get("verificationReport")
            .and_then(Value::as_str)
            .map(|text| truncate_chars(text, report_chars));
        let last_sync_error = task
            .get("lastSyncError")
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
            .map(|text| Value::String(truncate_chars(text, report_chars).0))
            .unwrap_or(Value::Null);
        json!({
            "id": str_or_null(task.get("id")),
            "title": str_or_null(task.get("title")),
            "objective": objective,
            "columnId": str_or_null(task.get("columnId")),
            "status": task.get("status").cloned().unwrap_or(Value::Null),
            "comments": comments,
            "commentsTotal": comments_total,
            "verificationVerdict": str_or_null(task.get("verificationVerdict")),
            "verificationReport": report.as_ref().map(|(text, _)| Value::String(text.clone())).unwrap_or(Value::Null),
            "acceptanceCriteria": string_array("acceptanceCriteria"),
            "verificationCommands": string_array("verificationCommands"),
            "labels": string_array("labels"),
            "laneSessions": lane_sessions,
            "lastSyncError": last_sync_error,
            "triggerSessionId": str_or_null(task.get("triggerSessionId")),
            "updatedAt": str_or_null(task.get("updatedAt")),
            "truncated": {
                "objective": objective_truncated,
                "verificationReport": report.as_ref().is_some_and(|(_, truncated)| *truncated),
            },
        })
    };

    let mut objective_chars = options
        .max_comment_chars
        .unwrap_or(DEFAULT_MAX_OBJECTIVE_CHARS);
    let mut report_chars = options
        .max_comment_chars
        .unwrap_or(DEFAULT_MAX_REPORT_CHARS);
    let mut snapshot = build(&comments, objective_chars, report_chars);
    // Drop oldest comments first; keep shrinking long texts only once no comment is left.
    loop {
        let bytes = pretty_bytes(&snapshot);
        if bytes <= max_bytes {
            break;
        }
        if !comments.is_empty() {
            let mut excess = bytes - max_bytes;
            loop {
                let size = pretty_bytes(&comments[0]);
                comments.remove(0);
                excess = excess.saturating_sub(size);
                if comments.is_empty() || excess == 0 || pretty_bytes(&comments[0]) >= excess {
                    break;
                }
            }
        } else if objective_chars <= MIN_FALLBACK_TEXT_CHARS
            && report_chars <= MIN_FALLBACK_TEXT_CHARS
        {
            break;
        } else {
            objective_chars = (objective_chars / 2).max(MIN_FALLBACK_TEXT_CHARS);
            report_chars = (report_chars / 2).max(MIN_FALLBACK_TEXT_CHARS);
        }
        snapshot = build(&comments, objective_chars, report_chars);
    }
    snapshot
}

/// A `triggerSessionId` match wins over a `laneSessions[].sessionId` match;
/// within a group the newest `updated_at` wins.
fn find_task_bound_to_session<'a>(tasks: &'a [Task], session_id: &str) -> Option<&'a Task> {
    let newest = |matches: Vec<&'a Task>| matches.into_iter().max_by_key(|task| task.updated_at);
    newest(
        tasks
            .iter()
            .filter(|task| task.trigger_session_id.as_deref() == Some(session_id))
            .collect(),
    )
    .or_else(|| {
        newest(
            tasks
                .iter()
                .filter(|task| {
                    task.lane_sessions
                        .iter()
                        .any(|lane| lane.session_id == session_id)
                })
                .collect(),
        )
    })
}

fn non_empty_arg<'a>(args: &'a Value, key: &str) -> Option<&'a str> {
    args.get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
}

pub(super) async fn execute(state: &AppState, args: &Value, workspace_id: &str) -> Value {
    let task = if let Some(task_id) = non_empty_arg(args, "taskId") {
        match state.task_store.get(task_id).await {
            Ok(Some(task)) => task,
            Ok(None) => return tool_result_error(&format!("Task not found: {task_id}")),
            Err(error) => return tool_result_error(&error.to_string()),
        }
    } else if let Some(session_id) = non_empty_arg(args, "sessionId") {
        let tasks = match state.task_store.list_by_workspace(workspace_id).await {
            Ok(tasks) => tasks,
            Err(error) => return tool_result_error(&error.to_string()),
        };
        match find_task_bound_to_session(&tasks, session_id) {
            Some(task) => task.clone(),
            None => {
                return tool_result_error(&format!(
                    "No card is bound to session {session_id} in workspace {workspace_id}; pass taskId."
                ))
            }
        }
    } else {
        return tool_result_error(
            "get_task needs a taskId: none was given and there is no current session to look up a bound card.",
        );
    };
    let value = serde_json::to_value(&task).unwrap_or_default();
    tool_result_json(&build_task_snapshot(
        &value,
        SnapshotOptions::from_args(args),
    ))
}

#[cfg(test)]
#[path = "get_task_tests.rs"]
mod tests;
