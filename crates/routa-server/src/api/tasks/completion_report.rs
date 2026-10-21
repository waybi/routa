//! Completion report summary for the `GET /api/tasks` list projection.
//!
//! Mirrors `src/core/kanban/completion-report.ts` (`isCompletionReportNote`,
//! `splitCompletionReports` ordering, `summarizeTaskCompletionReport`). Both
//! sides are pinned by `src/core/kanban/__fixtures__/completion-report-summary-cases.json`;
//! after changing a case, run the vitest suite and `cargo test -p routa-server completion_report`.

use std::sync::LazyLock;

use chrono::DateTime;
use regex::Regex;
use serde_json::{json, Map, Value};

const EXCERPT_MAX_CHARS: usize = 120;

const LABEL_PREFIX: &str = r"^\s*(?:[-*+]\s+)?(#{1,6}\s*)?(?:(\*\*)\s*)?(?:⚠\x{FE0F}?\s*)?(?:[一二三四五六七八九十]+[、.．]\s*)?(?:(\*\*)\s*)?";
const LABEL_SUFFIX: &str = r"\s*(?:\*\*\s*)?(?:([:：])\s*(.*?))?\s*$";

fn compile(pattern: &str) -> Regex {
    Regex::new(pattern).expect("completion report regex must compile")
}

/// Same pattern as `COMPLETION_REPORT_TITLE` in completion-report.ts.
static COMPLETION_REPORT_TITLE: LazyLock<Regex> = LazyLock::new(|| {
    compile(
        r"(?i)^\s*(?:#{1,6}\s*|[【\[]\s*)?(?:完成汇报|完工汇报|完成总结|完工总结|completion\s+(?:summary|report))",
    )
});
static SHIPPED_LABEL: LazyLock<Regex> = LazyLock::new(|| {
    compile(&format!(
        r"(?i){LABEL_PREFIX}(交付内容|完成内容|what\s+shipped){LABEL_SUFFIX}"
    ))
});
static LEFTOVER_LABEL: LazyLock<Regex> = LazyLock::new(|| {
    compile(&format!(
        r"(?i){LABEL_PREFIX}((?:遗留|未完成)[^:：*\s|]{{0,12}}?){LABEL_SUFFIX}"
    ))
});
static MAINLINE_LABEL: LazyLock<Regex> = LazyLock::new(|| {
    compile(r"(?i)^\s*(?:[-*+]\s+)?(?:\*\*\s*)?(?:主干提交号|mainline\s+commit)(.*)$")
});
static MAINLINE_FIRST_WORD: LazyLock<Regex> =
    LazyLock::new(|| compile(r"^[\s*:：`]*([0-9A-Za-z]+)"));
static HEADING: LazyLock<Regex> = LazyLock::new(|| compile(r"^\s*(#{1,6})(?:[^#]|$)"));
static BOLD_LIST_LABEL: LazyLock<Regex> =
    LazyLock::new(|| compile(r"^(\s*)(?:[-*+]\s+)?\*\*[^*]+?\*\*"));
static LINK: LazyLock<Regex> = LazyLock::new(|| compile(r"\[([^\]]*)\]\([^)]*\)"));
static LEADING_LIST_MARKER: LazyLock<Regex> =
    LazyLock::new(|| compile(r"^\s*(?:[-*+]|\d+[.)])\s+"));
static MARKDOWN_CHARS: LazyLock<Regex> = LazyLock::new(|| compile(r"[#*_`>]"));
static WHITESPACE_RUN: LazyLock<Regex> = LazyLock::new(|| compile(r"\s+"));
static TRAILING_PUNCT: LazyLock<Regex> = LazyLock::new(|| compile(r"[。.!！?？;；]+$"));

const LEFTOVER_BASE_LABELS: &[&str] = &["遗留", "遗留说明", "遗留事项", "遗留风险", "未完成"];
const NO_LEFTOVER_VALUES: &[&str] = &["无", "没有", "无遗留", "暂无", "none", "n/a"];
const SENTENCE_END: &[char] = &['。', '！', '？', '!', '?'];

pub fn is_completion_report_note(body: &str) -> bool {
    let first_line = body
        .split('\n')
        .find(|line| !line.trim().is_empty())
        .unwrap_or("");
    COMPLETION_REPORT_TITLE.is_match(first_line)
}

struct LabelMatch {
    heading_level: Option<usize>,
    inline: String,
}

fn match_label(line: &str, pattern: &Regex, leftover: bool) -> Option<LabelMatch> {
    let caps = pattern.captures(line)?;
    let heading = caps.get(1).map(|m| m.as_str());
    let bold = caps.get(2).is_some() || caps.get(3).is_some();
    let colon = caps.get(5).is_some();
    let label = caps.get(4).map(|m| m.as_str()).unwrap_or("");
    if leftover && !colon && heading.is_none() && !bold && !LEFTOVER_BASE_LABELS.contains(&label) {
        return None;
    }
    Some(LabelMatch {
        heading_level: heading.map(|h| h.trim().chars().count()),
        inline: caps
            .get(6)
            .map(|m| m.as_str().to_string())
            .unwrap_or_default(),
    })
}

fn strip_markdown(text: &str) -> String {
    let text = LINK.replace_all(text, "$1");
    let text = LEADING_LIST_MARKER.replace(&text, "");
    let text = MARKDOWN_CHARS.replace_all(&text, "");
    WHITESPACE_RUN.replace_all(&text, " ").trim().to_string()
}

fn first_sentence(text: &str) -> String {
    let mut out = String::new();
    for ch in text.chars() {
        out.push(ch);
        if SENTENCE_END.contains(&ch) {
            break;
        }
    }
    out
}

fn finalize_excerpt(raw: &str) -> Option<String> {
    // Link targets go first so a "?" inside a URL cannot end the sentence.
    let without_links = LINK.replace_all(raw, "$1");
    let cleaned = strip_markdown(&first_sentence(&without_links));
    if cleaned.is_empty() {
        return None;
    }
    if cleaned.chars().count() <= EXCERPT_MAX_CHARS {
        return Some(cleaned);
    }
    let head: String = cleaned.chars().take(EXCERPT_MAX_CHARS - 1).collect();
    Some(format!("{head}…"))
}

fn is_heading_like(line: &str) -> bool {
    line.trim_start().starts_with('#')
}

fn extract_excerpt(lines: &[&str]) -> Option<String> {
    for (index, line) in lines.iter().enumerate() {
        let Some(label) = match_label(line, &SHIPPED_LABEL, false) else {
            continue;
        };
        if !strip_markdown(&label.inline).is_empty() {
            return finalize_excerpt(&label.inline);
        }
        return lines[index + 1..]
            .iter()
            .find(|next| !next.trim().is_empty() && !is_heading_like(next))
            .and_then(|next| finalize_excerpt(next));
    }
    lines
        .iter()
        .find(|line| {
            !line.trim().is_empty() && !is_heading_like(line) && !is_completion_report_note(line)
        })
        .and_then(|line| finalize_excerpt(line))
}

/// Only the word right after the label counts; see the TS twin for why.
fn extract_mainline_commit(lines: &[&str]) -> Option<String> {
    let rest = lines
        .iter()
        .find_map(|line| MAINLINE_LABEL.captures(line))?
        .get(1)
        .map(|m| m.as_str().to_string())
        .unwrap_or_default();
    let token = MAINLINE_FIRST_WORD
        .captures(&rest)
        .and_then(|caps| caps.get(1))
        .map(|m| m.as_str())
        .unwrap_or("");
    let len = token.len();
    let is_hex = token.chars().all(|c| c.is_ascii_hexdigit());
    let has_letter = token.chars().any(|c| c.is_ascii_alphabetic());
    if (7..=40).contains(&len) && is_hex && has_letter {
        Some(token[..8.min(len)].to_ascii_lowercase())
    } else {
        None
    }
}

fn is_empty_leftover(content: &str) -> bool {
    let stripped = strip_markdown(content);
    let value = TRAILING_PUNCT.replace(&stripped, "").trim().to_lowercase();
    value.is_empty() || NO_LEFTOVER_VALUES.contains(&value.as_str())
}

fn detect_leftover(lines: &[&str]) -> bool {
    for (index, line) in lines.iter().enumerate() {
        let Some(label) = match_label(line, &LEFTOVER_LABEL, true) else {
            continue;
        };
        let indent = line.len() - line.trim_start().len();
        let mut parts = vec![label.inline.clone()];
        for next in &lines[index + 1..] {
            if let Some(caps) = HEADING.captures(next) {
                let level = caps[1].len();
                if label.heading_level.is_none_or(|own| level <= own) {
                    break;
                }
            }
            if label.heading_level.is_none() {
                if let Some(caps) = BOLD_LIST_LABEL.captures(next) {
                    if caps[1].len() <= indent {
                        break;
                    }
                }
            }
            parts.push((*next).to_string());
        }
        if !is_empty_leftover(&parts.join(" ")) {
            return true;
        }
    }
    false
}

fn summarize(body: &str, created_at: &str) -> Value {
    let lines: Vec<&str> = body.split('\n').collect();
    json!({
        "excerpt": extract_excerpt(&lines),
        "commit": extract_mainline_commit(&lines),
        "hasLeftover": detect_leftover(&lines),
        "createdAt": created_at,
    })
}

/// Same records `hydrateTaskComments(comments, comment)` yields on the Next side.
fn hydrate_comment_records(task: &Map<String, Value>) -> Vec<(String, String)> {
    if let Some(Value::Array(comments)) = task.get("comments") {
        if !comments.is_empty() {
            return comments
                .iter()
                .map(|entry| {
                    let field = |key: &str| {
                        entry
                            .get(key)
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string()
                    };
                    (field("body"), field("createdAt"))
                })
                .collect();
        }
    }
    match task.get("comment").and_then(Value::as_str).map(str::trim) {
        Some(legacy) if !legacy.is_empty() => vec![(legacy.to_string(), String::new())],
        _ => Vec::new(),
    }
}

fn parse_millis(value: &str) -> Option<i64> {
    if value.is_empty() {
        return None;
    }
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|time| time.timestamp_millis())
}

/// `completionReport` for one serialized task: the newest report's summary, or null.
pub fn summarize_task_completion_report(task: &Map<String, Value>) -> Value {
    let records = hydrate_comment_records(task);
    let mut reports: Vec<(usize, &(String, String))> = records
        .iter()
        .enumerate()
        .filter(|(_, (body, _))| is_completion_report_note(body))
        .collect();
    // Same comparator as splitCompletionReports: newer parseable time first,
    // otherwise the later position first.
    reports.sort_by(
        |(ia, (_, ca)), (ib, (_, cb))| match (parse_millis(ca), parse_millis(cb)) {
            (Some(ta), Some(tb)) if ta != tb => tb.cmp(&ta),
            _ => ib.cmp(ia),
        },
    );
    match reports.first() {
        Some((_, (body, created_at))) => summarize(body, created_at),
        None => Value::Null,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHARED_CASES: &str = include_str!(
        "../../../../../src/core/kanban/__fixtures__/completion-report-summary-cases.json"
    );

    fn task_for_case(case: &Value) -> Map<String, Value> {
        let mut task = Map::new();
        task.insert("comments".to_string(), case["comments"].clone());
        if let Some(legacy) = case.get("legacyComment") {
            task.insert("comment".to_string(), legacy.clone());
        }
        task
    }

    #[test]
    fn matches_shared_fixture_cases() {
        let fixture: Value = serde_json::from_str(SHARED_CASES).expect("shared fixture is JSON");
        let cases = fixture["cases"].as_array().expect("cases array");
        assert!(cases.len() >= 13, "fixture must keep at least 13 cases");
        for case in cases {
            let actual = summarize_task_completion_report(&task_for_case(case));
            assert_eq!(
                actual, case["expected"],
                "case {:?} drifted from the TS rules (after changing the fixture run both suites)",
                case["name"]
            );
        }
    }

    #[test]
    fn recognises_titles_like_the_ts_helper() {
        assert!(is_completion_report_note(
            "\n\n### Completion Summary\nbody"
        ));
        assert!(is_completion_report_note("【完成总结】 xxx"));
        assert!(is_completion_report_note("[完工总结]"));
        assert!(!is_completion_report_note("## Dev Evidence\n完成汇报"));
        assert!(!is_completion_report_note(""));
    }
}
