//! List-view projection for `GET /api/tasks`.
//!
//! Mirrors `src/app/api/tasks/task-list-projection.ts` so the shared frontend
//! sees the same shape on desktop and web. See that file for the measurement
//! that motivated it (8 cards = 3.3 MB, refetched on every `kanban:changed`).

use serde_json::Value;

/// Detail-only fields removed from the list projection.
const LIST_OMITTED_FIELDS: &[&str] = &[
    "comment",
    "comments",
    "jitContextSnapshot",
    "verificationReport",
    "contextSearchSpec",
];

/// Lane-session fields the board columns keep.
///
/// A card can accumulate a dozen runs, so every field is paid for per run per
/// card. The columns need session identity and run liveness; specialist/step
/// labels, `cwd`, and `objective` belong to the detail panel, which reads the
/// hydrated task.
const LIST_LANE_SESSION_FIELDS: &[&str] = &[
    "sessionId",
    "columnId",
    "status",
    "startedAt",
    "completedAt",
    "lastActivityAt",
];

/// Objective budget for the list projection; must match
/// `LIST_OBJECTIVE_MAX_CHARS` on the Next backend.
pub const LIST_OBJECTIVE_MAX_CHARS: usize = 1200;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskListView {
    Summary,
    Full,
}

impl TaskListView {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Summary => "summary",
            Self::Full => "full",
        }
    }
}

pub fn parse_task_list_view(raw: Option<&str>) -> TaskListView {
    match raw {
        Some("full") => TaskListView::Full,
        _ => TaskListView::Summary,
    }
}

fn project_lane_session(entry: &Value) -> Value {
    let Some(object) = entry.as_object() else {
        return entry.clone();
    };

    let mut projected = serde_json::Map::new();
    for field in LIST_LANE_SESSION_FIELDS {
        if let Some(value) = object.get(*field) {
            projected.insert((*field).to_string(), value.clone());
        }
    }
    Value::Object(projected)
}

/// Strips detail-only fields from one serialized task.
pub fn project_task_for_list(task: &Value) -> Value {
    let Some(object) = task.as_object() else {
        return task.clone();
    };

    let mut projected = object.clone();

    for field in LIST_OMITTED_FIELDS {
        projected.remove(*field);
    }

    if let Some(Value::Array(lane_sessions)) = projected.get("laneSessions") {
        let slimmed: Vec<Value> = lane_sessions.iter().map(project_lane_session).collect();
        projected.insert("laneSessions".to_string(), Value::Array(slimmed));
    }

    if let Some(objective) = object.get("objective").and_then(|value| value.as_str()) {
        if objective.chars().count() > LIST_OBJECTIVE_MAX_CHARS {
            let truncated: String = objective.chars().take(LIST_OBJECTIVE_MAX_CHARS).collect();
            projected.insert(
                "objective".to_string(),
                Value::String(format!("{truncated}\n…")),
            );
            // Signals that a consumer needing the whole story must fetch the
            // task by id instead of silently rendering a partial one.
            projected.insert("objectiveTruncated".to_string(), Value::Bool(true));
        }
    }

    Value::Object(projected)
}

pub fn project_tasks_for_list(tasks: Vec<Value>, view: TaskListView) -> Vec<Value> {
    match view {
        TaskListView::Full => tasks,
        TaskListView::Summary => tasks.iter().map(project_task_for_list).collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fat_task() -> Value {
        json!({
            "id": "task-1",
            "title": "Ship the thing",
            "objective": "short objective",
            "columnId": "dev",
            "comment": "accumulated blob",
            "comments": [{ "body": "note one" }],
            "jitContextSnapshot": { "analysis": { "big": "payload" } },
            "verificationReport": "pages of output",
            "contextSearchSpec": { "queries": ["a"] },
            "artifactSummary": { "total": 2 },
            "laneSessions": [{
                "sessionId": "session-1",
                "status": "running",
                "startedAt": "2026-01-01T00:00:00.000Z",
                "lastActivityAt": "2026-01-01T00:01:00.000Z",
                "objective": "x".repeat(38_000),
            }],
        })
    }

    #[test]
    fn defaults_to_summary_view() {
        assert_eq!(parse_task_list_view(None), TaskListView::Summary);
        assert_eq!(parse_task_list_view(Some("nonsense")), TaskListView::Summary);
        assert_eq!(parse_task_list_view(Some("full")), TaskListView::Full);
    }

    #[test]
    fn drops_detail_only_fields() {
        let projected = project_task_for_list(&fat_task());

        assert!(projected.get("comment").is_none());
        assert!(projected.get("comments").is_none());
        assert!(projected.get("jitContextSnapshot").is_none());
        assert!(projected.get("verificationReport").is_none());
        assert!(projected.get("contextSearchSpec").is_none());
        // Board-visible fields survive.
        assert_eq!(projected["id"].as_str(), Some("task-1"));
        assert_eq!(projected["artifactSummary"]["total"].as_i64(), Some(2));
    }

    #[test]
    fn strips_lane_session_objective_but_keeps_run_status() {
        let projected = project_task_for_list(&fat_task());
        let lane = &projected["laneSessions"][0];

        assert!(lane.get("objective").is_none());
        assert_eq!(lane["sessionId"].as_str(), Some("session-1"));
        assert_eq!(lane["status"].as_str(), Some("running"));
        assert_eq!(
            lane["lastActivityAt"].as_str(),
            Some("2026-01-01T00:01:00.000Z")
        );
    }

    #[test]
    fn leaves_short_objective_untouched() {
        let projected = project_task_for_list(&fat_task());

        assert_eq!(projected["objective"].as_str(), Some("short objective"));
        assert!(projected.get("objectiveTruncated").is_none());
    }

    #[test]
    fn truncates_and_flags_long_objective() {
        let mut task = fat_task();
        task["objective"] = Value::String("y".repeat(5_000));

        let projected = project_task_for_list(&task);

        assert_eq!(projected["objectiveTruncated"].as_bool(), Some(true));
        let objective = projected["objective"].as_str().expect("objective");
        assert!(objective.chars().count() < 5_000);
        assert!(objective.ends_with('…'));
    }

    #[test]
    fn full_view_passes_tasks_through() {
        let projected = project_tasks_for_list(vec![fat_task()], TaskListView::Full);
        assert!(projected[0].get("comment").is_some());
    }

    #[test]
    fn summary_view_shrinks_payload_by_an_order_of_magnitude() {
        let mut task = fat_task();
        task["objective"] = Value::String("y".repeat(14_000));

        let before = task.to_string().len();
        let after = project_task_for_list(&task).to_string().len();

        assert!(after < before / 10, "before={before} after={after}");
    }
}
