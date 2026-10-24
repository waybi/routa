use std::sync::Arc;

use routa_core::models::task::{Task, TaskLaneSession, VerificationVerdict};
use routa_core::{AppState, AppStateInner, Database};
use serde_json::{json, Value};

use super::*;

/// Same literal key lists as `src/core/tools/__tests__/get-task-fixtures.ts`.
const TOP_KEYS: [&str; 17] = [
    "acceptanceCriteria",
    "columnId",
    "comments",
    "commentsTotal",
    "id",
    "labels",
    "laneSessions",
    "lastSyncError",
    "objective",
    "status",
    "title",
    "triggerSessionId",
    "truncated",
    "updatedAt",
    "verificationCommands",
    "verificationReport",
    "verificationVerdict",
];
const LANE_KEYS: [&str; 7] = [
    "columnId",
    "completedAt",
    "role",
    "sessionId",
    "startedAt",
    "status",
    "stepName",
];

fn sorted_keys(value: &Value) -> Vec<String> {
    let mut keys: Vec<String> = value.as_object().expect("object").keys().cloned().collect();
    keys.sort();
    keys
}

/// The contract's "fixed card", serialized like the Next store (comments stored out of order).
fn fixed_card_json() -> Value {
    json!({
        "id": "task-fixed", "title": "Fixed card", "objective": "Ship get_task", "status": "REVIEW_REQUIRED",
        "columnId": "review", "labels": ["req:l296"], "acceptanceCriteria": ["AC1 works"],
        "verificationCommands": ["npx vitest run src/core/tools"],
        "comments": [
            { "id": "c2", "body": "second note", "createdAt": "2026-10-02T00:00:00.000Z", "source": "update_card" },
            { "id": "c1", "body": "first note", "createdAt": "2026-10-01T00:00:00.000Z", "source": "update_card" },
            { "id": "c3", "body": "third note", "createdAt": "2026-10-03T00:00:00.000Z", "source": "update_card" }
        ],
        "verificationVerdict": "NOT_APPROVED", "verificationReport": "Missing tests for AC4",
        "lastSyncError": "Push rejected", "triggerSessionId": "s-trigger",
        "laneSessions": [
            { "sessionId": "s-dev", "columnId": "dev", "stepName": "Dev Crafter", "role": "CRAFTER", "status": "completed",
              "startedAt": "2026-10-01T00:00:00.000Z", "completedAt": "2026-10-01T01:00:00.000Z",
              "objective": "x".repeat(5000), "cwd": "/tmp/worktree", "model": "claude-opus" },
            { "sessionId": "s-trigger", "columnId": "review", "stepName": "Review Guard", "role": "GATE", "status": "running",
              "startedAt": "2026-10-02T00:00:00.000Z", "objective": "y".repeat(5000), "cwd": "/tmp/worktree", "model": "gpt" }
        ],
        "updatedAt": "2026-10-03T12:00:00.000Z"
    })
}

fn big_card_json(ch: &str) -> Value {
    let mut card = fixed_card_json();
    let comments: Vec<Value> = (0..50)
        .rev()
        .map(|index| {
            let mut body = format!("{index}:");
            while body.chars().count() < 5000 {
                body.push_str(ch);
            }
            json!({ "id": format!("c-{index:02}"), "body": body, "createdAt": format!("2026-10-01T00:{index:02}:00.000Z") })
        })
        .collect();
    card["comments"] = Value::Array(comments);
    card["objective"] = Value::String(ch.repeat(10_000));
    card["verificationReport"] = Value::String(ch.repeat(20_000));
    card
}

#[test]
fn snapshot_has_the_ts_key_sets_ascending_comments_and_verdict() {
    let snapshot = build_task_snapshot(&fixed_card_json(), SnapshotOptions::default());
    assert_eq!(sorted_keys(&snapshot), TOP_KEYS);
    let ids: Vec<&str> = snapshot["comments"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["c1", "c2", "c3"]);
    assert_eq!(snapshot["comments"][0]["body"], "first note");
    assert!(snapshot["comments"]
        .as_array()
        .unwrap()
        .iter()
        .all(|c| c.get("truncated").is_none()));
    assert_eq!(snapshot["commentsTotal"], 3);
    assert_eq!(snapshot["verificationVerdict"], "NOT_APPROVED");
    assert_eq!(
        snapshot["truncated"],
        json!({ "objective": false, "verificationReport": false })
    );
    let lanes = snapshot["laneSessions"].as_array().unwrap();
    assert_eq!(lanes.len(), 2);
    for lane in lanes {
        assert_eq!(sorted_keys(lane), LANE_KEYS);
    }
    assert!(!serde_json::to_string(&snapshot)
        .unwrap()
        .contains("claude-opus"));
}

#[test]
fn big_card_stays_under_32_kb_with_truncation_markers() {
    for ch in ["汉", "a"] {
        let card = big_card_json(ch);
        let snapshot = build_task_snapshot(&card, SnapshotOptions::default());
        let bytes = serde_json::to_string_pretty(&snapshot).unwrap().len();
        assert!(bytes <= DEFAULT_MAX_BYTES, "{ch}: {bytes} bytes");
        assert_eq!(snapshot["commentsTotal"], 50);
        let comments = snapshot["comments"].as_array().unwrap();
        assert!(!comments.is_empty());
        assert_eq!(comments.last().unwrap()["id"], "c-49");
        for comment in comments {
            assert_eq!(comment["truncated"], true);
        }
        assert_eq!(
            snapshot["truncated"],
            json!({ "objective": true, "verificationReport": true })
        );
        assert!(card["objective"]
            .as_str()
            .unwrap()
            .starts_with(snapshot["objective"].as_str().unwrap()));
    }
}

#[test]
fn explicit_full_text_request_respects_the_hard_cap() {
    let options = SnapshotOptions {
        comment_limit: Some(1000),
        max_comment_chars: Some(1_000_000),
    };
    let snapshot = build_task_snapshot(&big_card_json("汉"), options);
    let bytes = serde_json::to_string_pretty(&snapshot).unwrap().len();
    assert!(bytes > DEFAULT_MAX_BYTES && bytes <= 262_144, "{bytes}");
}

#[test]
fn legacy_comment_is_hydrated_like_the_next_store() {
    let mut card = fixed_card_json();
    card.as_object_mut().unwrap().remove("comments");
    card["comment"] = json!("  legacy note  ");
    let snapshot = build_task_snapshot(&card, SnapshotOptions::default());
    assert_eq!(snapshot["comments"][0]["id"], "legacy-comment-1");
    assert_eq!(snapshot["comments"][0]["body"], "legacy note");
    assert_eq!(snapshot["commentsTotal"], 1);
}

fn lane(session_id: &str, status: &str) -> TaskLaneSession {
    serde_json::from_value(json!({
        "sessionId": session_id, "stepName": "Review Guard", "role": "GATE", "status": status,
        "startedAt": "2026-10-02T00:00:00Z", "objective": "o".repeat(3000), "columnId": "review"
    }))
    .expect("lane session")
}

async fn state_with_fixed_card() -> AppState {
    let db = Database::open_in_memory().expect("db");
    let state: AppState = Arc::new(AppStateInner::new(db));
    state
        .workspace_store
        .ensure_default()
        .await
        .expect("default workspace");
    let mut task = Task::new(
        "task-fixed".into(),
        "Fixed card".into(),
        "Ship get_task".into(),
        "default".into(),
        None,
        None,
        Some(vec!["AC1 works".into()]),
        Some(vec!["npx vitest run".into()]),
        None,
        None,
        None,
    );
    task.comment = Some("first note\n\nsecond note".into());
    task.verification_verdict = Some(VerificationVerdict::NotApproved);
    task.verification_report = Some("Missing tests for AC4".into());
    task.trigger_session_id = Some("s-trigger".into());
    task.lane_sessions = vec![lane("s-dev", "completed"), lane("s-trigger", "running")];
    state.task_store.save(&task).await.expect("save");
    state
}

fn payload(result: &Value) -> Value {
    assert_eq!(result["isError"], false, "{result}");
    serde_json::from_str(result["content"][0]["text"].as_str().unwrap()).unwrap()
}

#[tokio::test]
async fn store_backed_get_task_reads_by_id_and_by_session_without_writing() {
    let state = state_with_fixed_card().await;
    let before = state
        .task_store
        .get("task-fixed")
        .await
        .unwrap()
        .unwrap()
        .updated_at;

    // F4 ⑦: full catalog dispatch through the shared executor; ⑧ kanban-planning profile.
    for profile in [None, Some("kanban-planning")] {
        let by_id = super::super::execute_tool_for_profile_public(
            &state,
            "get_task",
            &json!({ "taskId": "task-fixed" }),
            profile,
        )
        .await;
        let data = payload(&by_id);
        assert_eq!(sorted_keys(&data), TOP_KEYS);
        assert_eq!(data["verificationVerdict"], "NOT_APPROVED");
        assert_eq!(data["comments"][0]["body"], "first note\n\nsecond note");
        for lane in data["laneSessions"].as_array().unwrap() {
            assert_eq!(sorted_keys(lane), LANE_KEYS);
        }

        for session in ["s-trigger", "s-dev"] {
            let by_session = super::super::execute_tool_for_profile_public(
                &state,
                "get_task",
                &json!({ "sessionId": session, "workspaceId": "default" }),
                profile,
            )
            .await;
            assert_eq!(payload(&by_session)["id"], "task-fixed");
        }
    }

    let missing = super::super::events_kanban::execute(
        &state,
        "get_task",
        &json!({ "taskId": "no-such-id" }),
        "default",
    )
    .await
    .expect("get_task is dispatched");
    assert_eq!(missing["isError"], true);
    assert!(missing["content"][0]["text"]
        .as_str()
        .unwrap()
        .contains("no-such-id"));

    let unbound = execute(&state, &json!({ "sessionId": "s-none" }), "default").await;
    assert_eq!(unbound["isError"], true);
    assert!(unbound["content"][0]["text"]
        .as_str()
        .unwrap()
        .contains("s-none"));
    let nothing = execute(&state, &json!({}), "default").await;
    assert_eq!(nothing["isError"], true);

    let after = state
        .task_store
        .get("task-fixed")
        .await
        .unwrap()
        .unwrap()
        .updated_at;
    assert_eq!(before, after);
}
