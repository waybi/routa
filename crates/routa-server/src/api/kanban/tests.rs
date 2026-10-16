use super::{
    list_boards, persisted_session_is_explicitly_terminal, revive_board,
    sanitize_stale_current_lane_automation, translate_agent_event_to_kanban_payload,
    translate_agent_event_to_lifecycle_payload, BoardsQuery, UpdateBoardRequest,
    LIFECYCLE_PREVIEW_MAX_CHARS,
};
use axum::extract::{Path, Query, State};
use chrono::Utc;
use routa_core::events::{AgentEvent, AgentEventType};
use routa_core::models::kanban::{default_kanban_columns, KanbanBoard, KanbanColumnAutomation};
use routa_core::models::task::{
    Task, TaskLaneSession, TaskLaneSessionRecoveryReason, TaskLaneSessionStatus, TaskStatus,
};
use routa_core::store::acp_session_store::CreateAcpSessionParams;
use routa_core::{AppState, AppStateInner, Database};
use serde_json::json;
use std::sync::Arc;

async fn setup_state() -> AppState {
    let db = Database::open_in_memory().expect("in-memory db should open");
    let state: AppState = Arc::new(AppStateInner::new(db));
    state
        .workspace_store
        .ensure_default()
        .await
        .expect("default workspace should exist");
    state
}

fn build_task(id: &str) -> Task {
    let mut task = Task::new(
        id.to_string(),
        "Review story".to_string(),
        "Recover stale automation".to_string(),
        "default".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    );
    task.board_id = Some("board-1".to_string());
    task.column_id = Some("review".to_string());
    task.status = TaskStatus::ReviewRequired;
    task
}

async fn persist_session(state: &AppState, session_id: &str, history: &[serde_json::Value]) {
    state
        .acp_session_store
        .create(CreateAcpSessionParams {
            id: session_id,
            cwd: ".",
            branch: None,
            workspace_id: "default",
            provider: Some("codex-acp"),
            role: Some("GATE"),
            custom_command: None,
            custom_args: None,
            parent_session_id: None,
        })
        .await
        .expect("session should persist");
    state
        .acp_session_store
        .save_history(session_id, history)
        .await
        .expect("history should persist");
}

#[test]
fn translates_workspace_updated_kanban_event() {
    let event = AgentEvent {
        event_type: AgentEventType::WorkspaceUpdated,
        agent_id: "user-1".to_string(),
        workspace_id: "ws-1".to_string(),
        data: json!({
            "scope": "kanban",
            "entity": "task",
            "action": "moved",
            "resourceId": "task-1",
            "source": "user",
        }),
        timestamp: Utc::now(),
    };

    let payload = translate_agent_event_to_kanban_payload(&event).expect("payload should exist");
    assert_eq!(payload["type"].as_str(), Some("kanban:changed"));
    assert_eq!(payload["workspaceId"].as_str(), Some("ws-1"));
    assert_eq!(payload["entity"].as_str(), Some("task"));
    assert_eq!(payload["action"].as_str(), Some("moved"));
    assert_eq!(payload["resourceId"].as_str(), Some("task-1"));
    assert_eq!(payload["source"].as_str(), Some("user"));
}

#[test]
fn translates_task_completed_into_lifecycle_payload() {
    let event = AgentEvent {
        event_type: AgentEventType::TaskCompleted,
        agent_id: "session-1".to_string(),
        workspace_id: "ws-1".to_string(),
        data: json!({
            "taskId": "task-1",
            "taskTitle": "Ship the thing",
            "sessionId": "session-1",
            "summary": "  all   green  ",
        }),
        timestamp: Utc::now(),
    };

    let payload = translate_agent_event_to_lifecycle_payload(&event).expect("payload should exist");
    assert_eq!(payload["type"].as_str(), Some("kanban:task-lifecycle"));
    assert_eq!(payload["workspaceId"].as_str(), Some("ws-1"));
    assert_eq!(payload["taskId"].as_str(), Some("task-1"));
    assert_eq!(payload["taskTitle"].as_str(), Some("Ship the thing"));
    assert_eq!(payload["phase"].as_str(), Some("completed"));
    assert_eq!(payload["sessionId"].as_str(), Some("session-1"));
    // Whitespace is normalized so the preview stays one readable line.
    assert_eq!(payload["lastMessagePreview"].as_str(), Some("all green"));
    assert_eq!(payload["source"].as_str(), Some("agent"));
}

#[test]
fn maps_review_column_completion_to_needs_review_phase() {
    let event = AgentEvent {
        event_type: AgentEventType::TaskCompleted,
        agent_id: "session-1".to_string(),
        workspace_id: "ws-1".to_string(),
        data: json!({
            "taskId": "task-1",
            "taskTitle": "Ship the thing",
            "columnId": "review",
        }),
        timestamp: Utc::now(),
    };

    let payload = translate_agent_event_to_lifecycle_payload(&event).expect("payload should exist");
    assert_eq!(payload["phase"].as_str(), Some("needs_review"));
}

#[test]
fn maps_task_failed_to_failed_phase() {
    let event = AgentEvent {
        event_type: AgentEventType::TaskFailed,
        agent_id: "session-1".to_string(),
        workspace_id: "ws-1".to_string(),
        data: json!({
            "taskId": "task-1",
            "taskTitle": "Ship the thing",
            "error": "provider exploded",
        }),
        timestamp: Utc::now(),
    };

    let payload = translate_agent_event_to_lifecycle_payload(&event).expect("payload should exist");
    assert_eq!(payload["phase"].as_str(), Some("failed"));
    assert_eq!(
        payload["lastMessagePreview"].as_str(),
        Some("provider exploded")
    );
}

#[test]
fn skips_lifecycle_payload_without_task_identity() {
    let event = AgentEvent {
        event_type: AgentEventType::TaskCompleted,
        agent_id: "session-1".to_string(),
        workspace_id: "ws-1".to_string(),
        data: json!({ "summary": "no card attached" }),
        timestamp: Utc::now(),
    };

    assert!(translate_agent_event_to_lifecycle_payload(&event).is_none());
}

#[test]
fn truncates_long_lifecycle_previews() {
    let long_summary = "x".repeat(400);
    let event = AgentEvent {
        event_type: AgentEventType::TaskCompleted,
        agent_id: "session-1".to_string(),
        workspace_id: "ws-1".to_string(),
        data: json!({
            "taskId": "task-1",
            "taskTitle": "Ship the thing",
            "summary": long_summary,
        }),
        timestamp: Utc::now(),
    };

    let payload = translate_agent_event_to_lifecycle_payload(&event).expect("payload should exist");
    let preview = payload["lastMessagePreview"].as_str().expect("preview");
    assert_eq!(preview.chars().count(), LIFECYCLE_PREVIEW_MAX_CHARS);
    assert!(preview.ends_with('…'));
}

#[test]
fn ignores_non_kanban_workspace_updates() {
    let event = AgentEvent {
        event_type: AgentEventType::WorkspaceUpdated,
        agent_id: "user-1".to_string(),
        workspace_id: "ws-1".to_string(),
        data: json!({
            "scope": "notes",
            "entity": "note",
            "action": "updated",
        }),
        timestamp: Utc::now(),
    };

    assert!(translate_agent_event_to_kanban_payload(&event).is_none());
}

#[test]
fn translates_runtime_fitness_workspace_updates() {
    let event = AgentEvent {
        event_type: AgentEventType::WorkspaceUpdated,
        agent_id: "system".to_string(),
        workspace_id: "ws-1".to_string(),
        data: json!({
            "scope": "fitness",
            "source": "system",
            "repoPath": "/tmp/repo",
            "status": "running",
        }),
        timestamp: Utc::now(),
    };

    let payload = translate_agent_event_to_kanban_payload(&event).expect("payload should exist");
    assert_eq!(payload["type"].as_str(), Some("fitness:changed"));
    assert_eq!(payload["workspaceId"].as_str(), Some("ws-1"));
    assert_eq!(payload["repoPath"].as_str(), Some("/tmp/repo"));
    assert_eq!(payload["status"].as_str(), Some("running"));
}

#[test]
fn translates_task_status_change_to_kanban_update() {
    let event = AgentEvent {
        event_type: AgentEventType::TaskStatusChanged,
        agent_id: "agent-1".to_string(),
        workspace_id: "ws-1".to_string(),
        data: json!({
            "taskId": "task-42",
            "status": "COMPLETED",
        }),
        timestamp: Utc::now(),
    };

    let payload = translate_agent_event_to_kanban_payload(&event).expect("payload should exist");
    assert_eq!(payload["type"].as_str(), Some("kanban:changed"));
    assert_eq!(payload["entity"].as_str(), Some("task"));
    assert_eq!(payload["action"].as_str(), Some("updated"));
    assert_eq!(payload["resourceId"].as_str(), Some("task-42"));
    assert_eq!(payload["source"].as_str(), Some("agent"));
}

#[test]
fn update_board_request_deserializes_github_token_fields() {
    let payload = serde_json::json!({
        "githubToken": "github_pat_test",
        "clearGitHubToken": true
    });

    let request: UpdateBoardRequest =
        serde_json::from_value(payload).expect("request should deserialize");

    assert_eq!(request.github_token.as_deref(), Some("github_pat_test"));
    assert_eq!(request.clear_github_token, Some(true));
}

#[tokio::test]
async fn stale_current_lane_sessions_are_marked_terminal_and_trigger_is_cleared() {
    let state = setup_state().await;
    let mut task = build_task("task-1");
    task.trigger_session_id = Some("session-1".to_string());
    task.lane_sessions.push(TaskLaneSession {
        session_id: "session-1".to_string(),
        routa_agent_id: None,
        column_id: Some("review".to_string()),
        column_name: Some("Review".to_string()),
        step_id: None,
        step_index: None,
        step_name: None,
        provider: Some("codex-acp".to_string()),
        role: Some("GATE".to_string()),
        specialist_id: None,
        specialist_name: None,
        transport: Some("acp".to_string()),
        external_task_id: None,
        context_id: None,
        attempt: Some(1),
        loop_mode: None,
        completion_requirement: None,
        objective: Some(task.objective.clone()),
        last_activity_at: None,
        recovered_from_session_id: None,
        recovery_reason: None,
        status: TaskLaneSessionStatus::Running,
        started_at: Utc::now().to_rfc3339(),
        completed_at: None,
    });

    let updated = sanitize_stale_current_lane_automation(&state, task)
        .await
        .expect("sanitize should succeed");

    assert_eq!(updated.trigger_session_id, None);
    assert_eq!(updated.lane_sessions.len(), 1);
    assert_eq!(
        updated.lane_sessions[0].status,
        TaskLaneSessionStatus::TimedOut
    );
    assert!(updated.lane_sessions[0].completed_at.is_some());
}

#[tokio::test]
async fn stale_sessions_with_verification_evidence_become_transitioned() {
    let state = setup_state().await;
    let mut task = build_task("task-2");
    task.trigger_session_id = Some("session-2".to_string());
    task.verification_report = Some("approved".to_string());
    task.lane_sessions.push(TaskLaneSession {
        session_id: "session-2".to_string(),
        routa_agent_id: None,
        column_id: Some("review".to_string()),
        column_name: Some("Review".to_string()),
        step_id: None,
        step_index: None,
        step_name: None,
        provider: Some("codex-acp".to_string()),
        role: Some("GATE".to_string()),
        specialist_id: None,
        specialist_name: None,
        transport: Some("acp".to_string()),
        external_task_id: None,
        context_id: None,
        attempt: Some(1),
        loop_mode: None,
        completion_requirement: None,
        objective: Some(task.objective.clone()),
        last_activity_at: None,
        recovered_from_session_id: None,
        recovery_reason: None,
        status: TaskLaneSessionStatus::Running,
        started_at: Utc::now().to_rfc3339(),
        completed_at: None,
    });

    let updated = sanitize_stale_current_lane_automation(&state, task)
        .await
        .expect("sanitize should succeed");

    assert_eq!(
        updated.lane_sessions[0].status,
        TaskLaneSessionStatus::Transitioned
    );
}

#[tokio::test]
async fn a2a_lane_sessions_are_not_marked_stale_by_missing_acp_runtime() {
    let state = setup_state().await;
    let mut task = build_task("task-3");
    task.trigger_session_id = Some("session-3".to_string());
    task.lane_sessions.push(TaskLaneSession {
        session_id: "session-3".to_string(),
        routa_agent_id: None,
        column_id: Some("review".to_string()),
        column_name: Some("Review".to_string()),
        step_id: None,
        step_index: None,
        step_name: None,
        provider: None,
        role: None,
        specialist_id: None,
        specialist_name: None,
        transport: Some("a2a".to_string()),
        external_task_id: Some("remote-task-1".to_string()),
        context_id: Some("ctx-1".to_string()),
        attempt: Some(1),
        loop_mode: None,
        completion_requirement: None,
        objective: Some(task.objective.clone()),
        last_activity_at: None,
        recovered_from_session_id: None,
        recovery_reason: None,
        status: TaskLaneSessionStatus::Running,
        started_at: Utc::now().to_rfc3339(),
        completed_at: None,
    });

    let updated = sanitize_stale_current_lane_automation(&state, task)
        .await
        .expect("sanitize should succeed");

    assert_eq!(updated.trigger_session_id.as_deref(), Some("session-3"));
    assert_eq!(
        updated.lane_sessions[0].status,
        TaskLaneSessionStatus::Running
    );
    assert_eq!(updated.lane_sessions[0].completed_at, None);
}

#[test]
fn persisted_session_history_only_becomes_terminal_on_explicit_runtime_error() {
    assert!(!persisted_session_is_explicitly_terminal(&[
        json!({
            "sessionId": "session-4",
            "update": {
                "sessionUpdate": "acp_status",
                "status": "ready",
            }
        }),
        json!({
            "sessionId": "session-4",
            "update": {
                "sessionUpdate": "agent_message",
                "content": { "text": "still resumable" }
            }
        }),
    ]));

    assert!(!persisted_session_is_explicitly_terminal(&[json!({
        "sessionId": "session-4",
        "update": {
            "sessionUpdate": "acp_status",
            "content": { "text": "connected" }
        }
    })]));

    assert!(persisted_session_is_explicitly_terminal(&[json!({
        "sessionId": "session-4",
        "update": {
            "sessionUpdate": "acp_status",
            "status": "error",
            "error": "session crashed"
        }
    })]));

    assert!(!persisted_session_is_explicitly_terminal(&[
        json!({
            "sessionId": "session-4",
            "update": {
                "sessionUpdate": "acp_status",
                "status": "error",
                "error": "session crashed"
            }
        }),
        json!({
            "sessionId": "session-4",
            "update": {
                "sessionUpdate": "acp_status",
                "status": "ready",
            }
        }),
    ]));
}

#[tokio::test]
async fn persisted_restorable_sessions_keep_lane_ownership_after_restart() {
    let state = setup_state().await;
    persist_session(
        &state,
        "session-4",
        &[json!({
            "sessionId": "session-4",
            "update": {
                "sessionUpdate": "agent_message",
                "content": { "text": "restorable" }
            }
        })],
    )
    .await;

    let mut task = build_task("task-4");
    task.trigger_session_id = Some("session-4".to_string());
    task.lane_sessions.push(TaskLaneSession {
        session_id: "session-4".to_string(),
        routa_agent_id: None,
        column_id: Some("review".to_string()),
        column_name: Some("Review".to_string()),
        step_id: None,
        step_index: None,
        step_name: None,
        provider: Some("codex-acp".to_string()),
        role: Some("GATE".to_string()),
        specialist_id: None,
        specialist_name: None,
        transport: Some("acp".to_string()),
        external_task_id: None,
        context_id: None,
        attempt: Some(1),
        loop_mode: None,
        completion_requirement: None,
        objective: Some(task.objective.clone()),
        last_activity_at: None,
        recovered_from_session_id: None,
        recovery_reason: None,
        status: TaskLaneSessionStatus::Running,
        started_at: Utc::now().to_rfc3339(),
        completed_at: None,
    });

    let updated = sanitize_stale_current_lane_automation(&state, task)
        .await
        .expect("sanitize should succeed");

    assert_eq!(updated.trigger_session_id.as_deref(), Some("session-4"));
    assert_eq!(
        updated.lane_sessions[0].status,
        TaskLaneSessionStatus::Running
    );
    assert_eq!(updated.lane_sessions[0].completed_at, None);
}

#[tokio::test]
async fn persisted_error_sessions_release_lane_ownership_after_restart() {
    let state = setup_state().await;
    persist_session(
        &state,
        "session-5",
        &[json!({
            "sessionId": "session-5",
            "update": {
                "sessionUpdate": "acp_status",
                "status": "error",
                "error": "worker exited"
            }
        })],
    )
    .await;

    let mut task = build_task("task-5");
    task.trigger_session_id = Some("session-5".to_string());
    task.lane_sessions.push(TaskLaneSession {
        session_id: "session-5".to_string(),
        routa_agent_id: None,
        column_id: Some("review".to_string()),
        column_name: Some("Review".to_string()),
        step_id: None,
        step_index: None,
        step_name: None,
        provider: Some("codex-acp".to_string()),
        role: Some("GATE".to_string()),
        specialist_id: None,
        specialist_name: None,
        transport: Some("acp".to_string()),
        external_task_id: None,
        context_id: None,
        attempt: Some(1),
        loop_mode: None,
        completion_requirement: None,
        objective: Some(task.objective.clone()),
        last_activity_at: None,
        recovered_from_session_id: None,
        recovery_reason: None,
        status: TaskLaneSessionStatus::Running,
        started_at: Utc::now().to_rfc3339(),
        completed_at: None,
    });

    let updated = sanitize_stale_current_lane_automation(&state, task)
        .await
        .expect("sanitize should succeed");

    assert_eq!(updated.trigger_session_id, None);
    assert_eq!(
        updated.lane_sessions[0].status,
        TaskLaneSessionStatus::TimedOut
    );
    assert!(updated.lane_sessions[0].completed_at.is_some());
}

fn running_lane_session(session_id: &str, column_id: &str) -> TaskLaneSession {
    TaskLaneSession {
        session_id: session_id.to_string(),
        routa_agent_id: None,
        column_id: Some(column_id.to_string()),
        column_name: None,
        step_id: None,
        step_index: None,
        step_name: None,
        provider: Some("codex-acp".to_string()),
        role: Some("GATE".to_string()),
        specialist_id: None,
        specialist_name: None,
        transport: Some("acp".to_string()),
        external_task_id: None,
        context_id: None,
        attempt: Some(1),
        loop_mode: None,
        completion_requirement: None,
        objective: None,
        last_activity_at: None,
        recovered_from_session_id: None,
        recovery_reason: None,
        status: TaskLaneSessionStatus::Running,
        started_at: Utc::now().to_rfc3339(),
        completed_at: None,
    }
}

/// Board with a stale (no live process) running review session.
async fn seed_board_with_stale_task(state: &AppState) {
    let now = Utc::now();
    state
        .kanban_store
        .create(&KanbanBoard {
            id: "board-1".to_string(),
            workspace_id: "default".to_string(),
            name: "Board".to_string(),
            is_default: false,
            github_token: None,
            columns: default_kanban_columns(),
            created_at: now,
            updated_at: now,
        })
        .await
        .expect("board should persist");
    let mut task = build_task("task-stale");
    task.trigger_session_id = Some("session-stale".to_string());
    task.lane_sessions
        .push(running_lane_session("session-stale", "review"));
    state
        .task_store
        .save(&task)
        .await
        .expect("task should persist");
}

#[tokio::test]
async fn list_boards_get_does_not_revive_stale_automation() {
    let state = setup_state().await;
    seed_board_with_stale_task(&state).await;

    let response = list_boards(
        State(state.clone()),
        Query(BoardsQuery {
            workspace_id: Some("default".to_string()),
        }),
    )
    .await
    .expect("list boards should succeed");
    let board_ids = response.0["boards"]
        .as_array()
        .expect("boards array")
        .iter()
        .filter_map(|board| board["id"].as_str())
        .collect::<Vec<_>>();
    assert!(board_ids.contains(&"board-1"));

    let task = state
        .task_store
        .get("task-stale")
        .await
        .expect("task lookup should succeed")
        .expect("task should exist");
    assert_eq!(task.trigger_session_id.as_deref(), Some("session-stale"));
    assert_eq!(task.lane_sessions.len(), 1);
    assert_eq!(task.lane_sessions[0].status, TaskLaneSessionStatus::Running);
    assert_eq!(task.last_sync_error, None);
}

#[tokio::test]
async fn revive_board_post_recovers_stale_automation() {
    let state = setup_state().await;
    seed_board_with_stale_task(&state).await;

    let response = revive_board(State(state.clone()), Path("board-1".to_string()))
        .await
        .expect("revive should succeed");
    assert_eq!(response.0["revived"].as_bool(), Some(true));
    assert_eq!(response.0["workspaceId"].as_str(), Some("default"));

    let task = state
        .task_store
        .get("task-stale")
        .await
        .expect("task lookup should succeed")
        .expect("task should exist");
    assert_eq!(task.trigger_session_id, None);
    assert_eq!(
        task.lane_sessions[0].status,
        TaskLaneSessionStatus::TimedOut
    );
}

#[tokio::test]
async fn revive_board_post_skips_cards_awaiting_environment_fix() {
    let state = setup_state().await;
    let now = Utc::now();
    let mut columns = default_kanban_columns();
    let dev = columns
        .iter_mut()
        .find(|column| column.id == "dev")
        .expect("dev column should exist");
    dev.automation = Some(KanbanColumnAutomation {
        enabled: true,
        provider_id: Some("opencode".to_string()),
        role: Some("CRAFTER".to_string()),
        transition_type: Some("entry".to_string()),
        ..Default::default()
    });
    state
        .kanban_store
        .create(&KanbanBoard {
            id: "board-1".to_string(),
            workspace_id: "default".to_string(),
            name: "Board".to_string(),
            is_default: false,
            github_token: None,
            columns,
            created_at: now,
            updated_at: now,
        })
        .await
        .expect("board should persist");

    let failed_session = |session_id: &str, reason| {
        let mut entry = running_lane_session(session_id, "dev");
        entry.status = TaskLaneSessionStatus::Failed;
        entry.recovery_reason = Some(reason);
        entry.completed_at = Some(Utc::now().to_rfc3339());
        entry
    };
    for (task_id, session_id, reason) in [
        (
            "task-env",
            "session-env",
            TaskLaneSessionRecoveryReason::EnvironmentFailure,
        ),
        (
            "task-agent",
            "session-agent",
            TaskLaneSessionRecoveryReason::AgentFailed,
        ),
    ] {
        let mut task = build_task(task_id);
        task.column_id = Some("dev".to_string());
        task.status = TaskStatus::InProgress;
        task.lane_sessions.push(failed_session(session_id, reason));
        state
            .task_store
            .save(&task)
            .await
            .expect("task should persist");
    }

    let response = revive_board(State(state.clone()), Path("board-1".to_string()))
        .await
        .expect("revive should succeed");
    assert_eq!(response.0["revived"].as_bool(), Some(true));

    let env_task = state
        .task_store
        .get("task-env")
        .await
        .expect("task lookup should succeed")
        .expect("task should exist");
    assert_eq!(env_task.trigger_session_id, None);
    assert_eq!(env_task.last_sync_error, None);
    assert_eq!(env_task.lane_sessions.len(), 1);

    // Control: an ordinary agent failure in the same lane is revived.
    let agent_task = state
        .task_store
        .get("task-agent")
        .await
        .expect("task lookup should succeed")
        .expect("task should exist");
    assert!(
        agent_task.trigger_session_id.is_some() || agent_task.last_sync_error.is_some(),
        "revive should attempt to re-trigger an ordinary failed card"
    );
}

#[tokio::test]
async fn revive_board_post_returns_not_found_for_unknown_board() {
    let state = setup_state().await;
    let result = revive_board(State(state), Path("missing".to_string())).await;
    assert!(matches!(
        result,
        Err(crate::error::ServerError::NotFound(_))
    ));
}
