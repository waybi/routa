//! Blocked lane automation tests (card 64f2e31c); kept out of kanban.rs,
//! which is over the file budget.

use super::super::{
    create_card, list_boards, move_card, CreateCardParams, ListBoardsParams, MoveCardParams,
};
use crate::db::Database;
use crate::models::kanban::KanbanColumnAutomation;
use crate::state::{AppState, AppStateInner};
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

// Card 64f2e31c: a Blocked column configured with enabled=true starts its
// resolver on entry (it used to be forced to false).
#[tokio::test]
async fn move_card_to_blocked_starts_configured_resolver_automation() {
    let state = setup_state().await;
    let boards = list_boards(
        &state,
        ListBoardsParams {
            workspace_id: "default".to_string(),
        },
    )
    .await
    .expect("list boards should succeed");
    let board_id = boards.boards[0].id.clone();
    let mut board = state
        .kanban_store
        .get(&board_id)
        .await
        .expect("board load should succeed")
        .expect("default board should exist");
    let blocked = board
        .columns
        .iter_mut()
        .find(|column| column.id == "blocked")
        .expect("blocked column should exist");
    blocked.automation = Some(KanbanColumnAutomation {
        enabled: true,
        provider_id: Some("opencode".to_string()),
        role: Some("CRAFTER".to_string()),
        specialist_id: Some("kanban-blocked-resolver".to_string()),
        specialist_name: Some("Blocked Resolver".to_string()),
        transition_type: Some("entry".to_string()),
        ..Default::default()
    });
    state
        .kanban_store
        .update(&board)
        .await
        .expect("board update should succeed");
    let stored = state
        .kanban_store
        .get(&board_id)
        .await
        .expect("board load should succeed")
        .expect("board should exist");
    let blocked_enabled =
        crate::models::kanban::apply_recommended_automation_to_columns(stored.columns)
            .into_iter()
            .find(|column| column.id == "blocked")
            .and_then(|column| column.automation)
            .map(|automation| automation.enabled);
    assert_eq!(
        blocked_enabled,
        Some(true),
        "listing must keep enabled=true"
    );

    let created = create_card(
        &state,
        CreateCardParams {
            workspace_id: "default".to_string(),
            board_id: Some(board_id.clone()),
            column_id: Some("backlog".to_string()),
            title: "Resolve me".to_string(),
            description: None,
            priority: None,
            labels: None,
        },
    )
    .await
    .expect("create card should succeed");
    move_card(
        &state,
        MoveCardParams {
            card_id: created.card.id.clone(),
            target_column_id: "blocked".to_string(),
            position: None,
        },
    )
    .await
    .expect("move card should succeed");
    let task = state
        .task_store
        .get(&created.card.id)
        .await
        .expect("task lookup should succeed")
        .expect("task should exist");
    assert_eq!(task.column_id.as_deref(), Some("blocked"));
    assert!(
        task.trigger_session_id.is_some() || task.last_sync_error.is_some(),
        "blocked resolver automation should either start a session or record why it could not"
    );
}
