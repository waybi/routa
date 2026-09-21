//! Session live-tail extraction.
//!
//! Mirrors `src/core/session-tail.ts` so the shared board renders the same
//! caption on desktop and web. See that file for why the board stopped
//! downloading full history to compute one line.

use serde_json::Value;

/// Keeps the tail a caption, not a transcript.
pub const SESSION_TAIL_MAX_CHARS: usize = 240;

const TAIL_UPDATE_TYPES: &[&str] = &["agent_message", "agent_message_chunk", "user_message"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionTail {
    pub text: String,
    /// Which update produced the tail, useful for debugging a stuck caption.
    pub update_type: String,
}

fn extract_text(content: &Value) -> Option<String> {
    if let Some(text) = content.as_str() {
        let trimmed = text.trim();
        return (!trimmed.is_empty()).then(|| trimmed.to_string());
    }

    if let Some(text) = content.get("text").and_then(|value| value.as_str()) {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    if let Some(parts) = content.get("content").and_then(|value| value.as_array()) {
        let joined: String = parts
            .iter()
            .filter_map(|item| item.get("text").and_then(|value| value.as_str()))
            .collect();
        let trimmed = joined.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    None
}

pub fn truncate_session_tail(text: &str) -> String {
    let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.chars().count() <= SESSION_TAIL_MAX_CHARS {
        return normalized;
    }
    let mut truncated: String = normalized.chars().take(SESSION_TAIL_MAX_CHARS - 1).collect();
    truncated.push('…');
    truncated
}

/// Walks the history backwards and returns the newest message-shaped entry.
/// Tool calls and status updates are skipped: they are noise in a caption.
pub fn extract_session_tail(history: &[Value]) -> Option<SessionTail> {
    for entry in history.iter().rev() {
        let Some(update) = entry.get("update") else {
            continue;
        };
        let Some(update_type) = update.get("sessionUpdate").and_then(|value| value.as_str()) else {
            continue;
        };
        if !TAIL_UPDATE_TYPES.contains(&update_type) {
            continue;
        }
        let Some(content) = update.get("content") else {
            continue;
        };
        if let Some(text) = extract_text(content) {
            return Some(SessionTail {
                text: truncate_session_tail(&text),
                update_type: update_type.to_string(),
            });
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn entry(session_update: &str, content: Value) -> Value {
        json!({ "sessionId": "session-1", "update": { "sessionUpdate": session_update, "content": content } })
    }

    #[test]
    fn returns_the_newest_agent_message() {
        let history = vec![
            entry("agent_message", json!({ "text": "first" })),
            entry("agent_message", json!({ "text": "second" })),
        ];

        let tail = extract_session_tail(&history).expect("tail");
        assert_eq!(tail.text, "second");
        assert_eq!(tail.update_type, "agent_message");
    }

    #[test]
    fn skips_tool_calls_and_status_updates() {
        let history = vec![
            entry("agent_message", json!({ "text": "the real last line" })),
            entry("tool_call", json!({ "title": "bash" })),
            entry("usage_update", json!({ "used": 1 })),
        ];

        assert_eq!(
            extract_session_tail(&history).expect("tail").text,
            "the real last line"
        );
    }

    #[test]
    fn collapses_whitespace() {
        let history = vec![entry("agent_message", json!({ "text": "  multi\n\nline   text " }))];
        assert_eq!(
            extract_session_tail(&history).expect("tail").text,
            "multi line text"
        );
    }

    #[test]
    fn reads_text_out_of_a_content_array() {
        let history = vec![entry(
            "agent_message_chunk",
            json!({ "content": [{ "text": "chunk one " }, { "text": "chunk two" }] }),
        )];

        let tail = extract_session_tail(&history).expect("tail");
        assert_eq!(tail.text, "chunk one chunk two");
        assert_eq!(tail.update_type, "agent_message_chunk");
    }

    #[test]
    fn accepts_plain_string_content() {
        let history = vec![entry("user_message", json!("hello"))];
        assert_eq!(extract_session_tail(&history).expect("tail").text, "hello");
    }

    #[test]
    fn truncates_long_messages() {
        let history = vec![entry("agent_message", json!({ "text": "x".repeat(1000) }))];
        let tail = extract_session_tail(&history).expect("tail");

        assert_eq!(tail.text.chars().count(), SESSION_TAIL_MAX_CHARS);
        assert!(tail.text.ends_with('…'));
    }

    #[test]
    fn returns_none_for_empty_or_message_free_history() {
        assert!(extract_session_tail(&[]).is_none());
        assert!(extract_session_tail(&[entry("tool_call", json!({ "title": "bash" }))]).is_none());
        assert!(extract_session_tail(&[json!({ "noUpdate": true })]).is_none());
    }
}
