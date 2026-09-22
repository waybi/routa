//! `/api/tasks/{id}/human-summary` — human-readable ("人话版") card summary.
//!
//! Mirrors `src/app/api/tasks/[taskId]/human-summary/route.ts` and the pure helpers in
//! `src/core/kanban/task-human-summary.ts`. Both backends share the same on-disk cache
//! (`~/.routa/task-summaries/<taskId>.<lang>.json`, keyed by the description sha256), so
//! the hash, file naming, prompt text and banned-phrase list here must stay byte-for-byte
//! aligned with the TypeScript side. Change them together, in the same commit.
//!
//! GET  ?language=zh-CN|en → cached record (if any) + current description hash. Never calls the model.
//! POST { language, force? } → returns the cache when its hash matches; otherwise generates, saves, returns.

use std::env;
use std::path::PathBuf;

use axum::{
    extract::{Path as AxumPath, Query, State},
    Json,
};
use regex::Regex;
use routa_core::models::task::Task;
use routa_core::workflow::agent_caller::{AcpAgentCaller, AgentCallConfig};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::ServerError;
use crate::state::AppState;

// ─── Public wire types (same shape as the TS side) ───────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SummaryLanguage {
    #[serde(rename = "zh-CN")]
    ZhCn,
    #[serde(rename = "en")]
    En,
}

impl SummaryLanguage {
    fn from_loose(value: Option<&str>) -> Self {
        match value {
            Some("en") => Self::En,
            _ => Self::ZhCn,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::ZhCn => "zh-CN",
            Self::En => "en",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SummaryEvidence {
    pub label: String,
    #[serde(rename = "where")]
    pub location: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SummaryContent {
    pub what: String,
    #[serde(rename = "where")]
    pub where_now: String,
    #[serde(rename = "blockedNext")]
    pub blocked_next: String,
    pub evidence: Vec<SummaryEvidence>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SummaryRecord {
    pub task_id: String,
    pub description_hash: String,
    pub language: SummaryLanguage,
    pub model: String,
    pub generated_at: String,
    pub summary: SummaryContent,
    pub lint_hits: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryResponse {
    pub task_id: String,
    pub description_hash: String,
    pub language: SummaryLanguage,
    pub record: Option<SummaryRecord>,
    pub stale: bool,
    pub cached: bool,
}

#[derive(Debug, Deserialize, Default)]
pub struct SummaryQuery {
    pub language: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct SummaryPostBody {
    pub language: Option<String>,
    pub force: Option<bool>,
}

// ─── Hash (must equal TS hashTaskDescription) ────────────────────────────────

pub fn normalize_description(description: &str) -> String {
    description.replace("\r\n", "\n").trim().to_string()
}

pub fn hash_task_description(description: &str) -> String {
    let normalized = normalize_description(description);
    let digest = Sha256::digest(normalized.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

// ─── File store (same path + file name as TS FileTaskHumanSummaryStore) ──────

pub fn resolve_summary_dir() -> PathBuf {
    if let Ok(dir) = env::var("ROUTA_TASK_SUMMARY_DIR") {
        return PathBuf::from(dir);
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".routa")
        .join("task-summaries")
}

fn sanitize_segment(value: &str) -> String {
    value
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

pub struct FileSummaryStore {
    root: PathBuf,
}

impl FileSummaryStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn default_location() -> Self {
        Self::new(resolve_summary_dir())
    }

    fn file_path(&self, task_id: &str, language: SummaryLanguage) -> PathBuf {
        self.root.join(format!(
            "{}.{}.json",
            sanitize_segment(task_id),
            sanitize_segment(language.as_str())
        ))
    }

    pub async fn get(&self, task_id: &str, language: SummaryLanguage) -> Option<SummaryRecord> {
        let raw = tokio::fs::read_to_string(self.file_path(task_id, language))
            .await
            .ok()?;
        serde_json::from_str::<SummaryRecord>(&raw).ok()
    }

    pub async fn save(&self, record: &SummaryRecord) -> Result<(), ServerError> {
        tokio::fs::create_dir_all(&self.root)
            .await
            .map_err(|e| ServerError::Internal(format!("create summary dir: {e}")))?;
        let target = self.file_path(&record.task_id, record.language);
        let tmp = target.with_extension(format!("json.{}.tmp", std::process::id()));
        let body = serde_json::to_string_pretty(record)
            .map_err(|e| ServerError::Internal(format!("serialize summary: {e}")))?;
        tokio::fs::write(&tmp, body)
            .await
            .map_err(|e| ServerError::Internal(format!("write summary tmp: {e}")))?;
        tokio::fs::rename(&tmp, &target)
            .await
            .map_err(|e| ServerError::Internal(format!("rename summary: {e}")))?;
        Ok(())
    }
}

// ─── Deterministic facts (subset of TS extractTaskHumanSummaryFacts) ─────────

#[derive(Debug, Default, Deserialize)]
struct LooseStoryEnvelope {
    story: Option<LooseStory>,
}

#[derive(Debug, Default, Deserialize)]
struct LooseStory {
    title: Option<String>,
    acceptance_criteria: Option<Vec<LooseCriterion>>,
    dependencies_and_sequencing: Option<LooseDeps>,
    invest: Option<LooseInvest>,
}

#[derive(Debug, Default, Deserialize)]
struct LooseCriterion {
    id: Option<String>,
    text: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct LooseDeps {
    independent_story_check: Option<String>,
    depends_on: Option<Vec<String>>,
    unblock_condition: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct LooseInvest {
    independent: Option<LooseCheck>,
}

#[derive(Debug, Default, Deserialize)]
struct LooseCheck {
    reason: Option<String>,
}

#[derive(Debug, Default, Clone)]
pub struct SummaryFacts {
    pub title: String,
    pub lane_id: String,
    pub acceptance_criteria: Vec<(String, String)>,
    pub block_reason: Option<String>,
    pub depends_on: Vec<String>,
    pub unblock_condition: Option<String>,
    pub section_headings: Vec<String>,
}

fn extract_yaml_block(content: &str) -> Option<&str> {
    let lower = content.to_ascii_lowercase();
    let start = lower.find("```yaml")?;
    let after_fence = &content[start + "```yaml".len()..];
    let body_start = after_fence.find('\n')? + 1;
    let body = &after_fence[body_start..];
    let end = body.find("\n```")?;
    Some(body[..end].trim())
}

fn strip_fences(content: &str) -> String {
    let mut out = String::with_capacity(content.len());
    let mut rest = content;
    while let Some(start) = rest.find("```") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 3..];
        match after.find("```") {
            Some(end) => rest = &after[end + 3..],
            None => {
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

fn collect_headings(content: &str) -> Vec<String> {
    strip_fences(content)
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim_end();
            let hashes = trimmed.chars().take_while(|c| *c == '#').count();
            if hashes == 0 || hashes > 6 {
                return None;
            }
            let rest = trimmed[hashes..].trim();
            if rest.is_empty() || !trimmed[hashes..].starts_with(' ') {
                return None;
            }
            Some(rest.to_string())
        })
        .collect()
}

fn non_empty(value: Option<String>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

pub fn extract_facts(task: &Task) -> SummaryFacts {
    let description = normalize_description(&task.objective);
    let lane_id = task
        .column_id
        .clone()
        .unwrap_or_else(|| "backlog".to_string());
    let headings = collect_headings(&description);
    let story = extract_yaml_block(&description)
        .and_then(|yaml| serde_yaml::from_str::<LooseStoryEnvelope>(yaml).ok())
        .and_then(|env| env.story)
        .unwrap_or_default();

    let deps = story.dependencies_and_sequencing.unwrap_or_default();
    let independent_fail = deps.independent_story_check.as_deref() == Some("fail");
    let independent_reason = story
        .invest
        .and_then(|i| i.independent)
        .and_then(|c| non_empty(c.reason));
    let unblock = non_empty(deps.unblock_condition);

    let blocked_heading = headings
        .iter()
        .find(|h| h.contains("阻塞") || h.to_ascii_lowercase().contains("blocked"))
        .cloned();

    let block_reason = if independent_fail {
        independent_reason.or_else(|| unblock.clone())
    } else if blocked_heading.is_some() {
        blocked_heading
    } else if lane_id == "blocked" {
        Some(lane_id.clone())
    } else {
        None
    };

    SummaryFacts {
        title: non_empty(story.title).unwrap_or_else(|| task.title.clone()),
        lane_id,
        acceptance_criteria: story
            .acceptance_criteria
            .unwrap_or_default()
            .into_iter()
            .filter_map(|c| Some((non_empty(c.id)?, non_empty(c.text)?)))
            .collect(),
        block_reason,
        depends_on: deps
            .depends_on
            .unwrap_or_default()
            .into_iter()
            .map(|d| d.trim().to_string())
            .filter(|d| !d.is_empty())
            .collect(),
        unblock_condition: unblock,
        section_headings: headings,
    }
}

// ─── Prompt (verbatim from src/core/kanban/task-human-summary.ts) ────────────

const STYLE_RULES_ZH: &str = "写作规则（全部必须遵守）：
1. 结论先行。每一段先给结论，再给依据。
2. 说人话：用常见词和精确动词，主动语态。术语、缩写、UUID 第一次出现时紧跟一句大白话解释（例如「5cea679a（请求转发层那张卡）」）。
3. 只写最新状态，禁止按轮次记流水账。what / where / blockedNext 三段和证据名称里禁止出现「第 N 轮」「第一轮」「上一轮」等字样；描述里带轮次的章节标题只允许原样写进证据的 where 定位字段。
4. 黑名单，一个都不能出现：值得注意的是、综上所述、总的来说、简单来说、不是分歧、以及任何「不是 X 而是 Y」式的对比句。
5. 不夸自己，不评价流程；描述里的情绪词、加粗强调一律去掉。
6. 证据按「读者最容易自行核对」排序，不按时间排序。每条证据给一个可搜索的定位（章节标题、AC 编号、文件:行号、artifact 类型）。
7. 每段不超过 3 句；四段合计不超过 300 字（证据列表不计）。";

const STYLE_RULES_EN: &str = "Writing rules (all mandatory):
1. Lead with the conclusion in every field, then the reasoning.
2. Plain language: familiar words, precise verbs, active voice. The first time a term, acronym or UUID appears, follow it with a one-clause plain explanation, e.g. \"5cea679a (the request-forwarding card)\".
3. Describe the latest state only. Never narrate by rounds in what / where / blockedNext or evidence labels: no \"round 1\", \"second pass\", \"previous iteration\". A section heading that contains a round number may only be quoted verbatim inside an evidence \"where\" locator.
4. Banned, never emit: \"it's worth noting\", \"importantly\", \"in summary\", \"delve\", \"leverage\", and any \"not X but Y\" contrast framing.
5. No self-praise, no process commentary; drop emphasis and emotional wording from the source.
6. Order evidence by how easily a reader can verify it, not by time. Each item names a searchable location (section heading, AC id, file:line, artifact type).
7. At most 3 sentences per field; the four prose fields together stay under 180 words (evidence list excluded).";

const MAX_DESCRIPTION_CHARS: usize = 24_000;

fn format_facts(facts: &SummaryFacts, language: SummaryLanguage) -> String {
    let zh = language == SummaryLanguage::ZhCn;
    let (l_title, l_lane, l_ac, l_block, l_deps, l_unblock, l_head) = if zh {
        (
            "标题",
            "当前泳道",
            "验收标准",
            "阻塞原因",
            "依赖卡",
            "解锁条件",
            "描述章节",
        )
    } else {
        (
            "Title",
            "Current lane",
            "Acceptance criteria",
            "Block reason",
            "Depends on",
            "Unblock condition",
            "Description sections",
        )
    };
    let mut lines = vec![
        format!("{l_title}: {}", facts.title),
        format!("{l_lane}: {}", facts.lane_id),
    ];
    if !facts.acceptance_criteria.is_empty() {
        lines.push(format!("{l_ac}:"));
        for (id, text) in &facts.acceptance_criteria {
            lines.push(format!("- {id}: {text}"));
        }
    }
    if let Some(reason) = &facts.block_reason {
        lines.push(format!("{l_block}: {reason}"));
    }
    if !facts.depends_on.is_empty() {
        lines.push(format!("{l_deps}: {}", facts.depends_on.join(", ")));
    }
    if let Some(unblock) = &facts.unblock_condition {
        lines.push(format!("{l_unblock}: {unblock}"));
    }
    if !facts.section_headings.is_empty() {
        lines.push(format!("{l_head}: {}", facts.section_headings.join(" | ")));
    }
    lines.join("\n")
}

pub fn build_prompt(
    language: SummaryLanguage,
    facts: &SummaryFacts,
    description: &str,
    previous_lint_hits: &[String],
) -> String {
    let zh = language == SummaryLanguage::ZhCn;
    let description = if description.chars().count() > MAX_DESCRIPTION_CHARS {
        let cut: String = description.chars().take(MAX_DESCRIPTION_CHARS).collect();
        format!("{cut}\n\n[truncated]")
    } else {
        description.to_string()
    };
    let retry_note = if previous_lint_hits.is_empty() {
        String::new()
    } else if zh {
        format!(
            "\n上一版命中了黑名单：{}。请重写并彻底避开这些词和句式。\n",
            previous_lint_hits.join("、")
        )
    } else {
        format!(
            "\nThe previous draft contained banned phrases: {}. Rewrite and avoid them entirely.\n",
            previous_lint_hits.join(", ")
        )
    };
    let intro = if zh {
        "你是看板卡片的总结器。下面这张卡片的描述是写给 agent 看的（机器契约 YAML + 过程日志），请把它改写成给人看的四段摘要。只能使用描述里出现的事实，不得补充或推测。"
    } else {
        "You summarize kanban cards. The description below was written for agents (machine YAML contract + process log). Rewrite it as a four-part summary for a human reader. Use only facts present in the description; do not add or infer."
    };
    let layout = if zh {
        "输出格式：只输出一个 JSON 对象，不加任何解释或代码围栏：
{
  \"what\": \"这张卡要做什么（一句话）\",
  \"where\": \"现在到哪一步（最新状态）\",
  \"blockedNext\": \"卡在哪 / 下一步谁做什么\",
  \"evidence\": [ { \"label\": \"证据名称\", \"where\": \"在描述里怎么找到（章节标题 / AC 编号 / 文件:行号 / artifact 类型）\" } ]
}
evidence 给 2 到 6 条。全部内容使用简体中文。"
    } else {
        "Output format: exactly one JSON object, no explanation, no code fence:
{
  \"what\": \"what this card is for (one sentence)\",
  \"where\": \"where the work stands now (latest state)\",
  \"blockedNext\": \"what blocks it / who does what next\",
  \"evidence\": [ { \"label\": \"evidence name\", \"where\": \"how to find it in the description (section heading / AC id / file:line / artifact type)\" } ]
}
Give 2 to 6 evidence items. Write everything in English."
    };
    [
        intro.to_string(),
        String::new(),
        (if zh { STYLE_RULES_ZH } else { STYLE_RULES_EN }).to_string(),
        retry_note,
        (if zh {
            "已确定的事实（由程序解析，可直接引用）："
        } else {
            "Facts already extracted by the program (safe to reference):"
        })
        .to_string(),
        format_facts(facts, language),
        String::new(),
        (if zh {
            "卡片描述原文："
        } else {
            "Card description:"
        })
        .to_string(),
        "<<<DESCRIPTION".to_string(),
        description,
        "DESCRIPTION>>>".to_string(),
        String::new(),
        layout.to_string(),
    ]
    .join("\n")
}

// ─── Banned-phrase lint (same list + same where-exemption as TS) ─────────────

const BANNED_PATTERNS: &[(&str, &str)] = &[
    ("值得注意的是", "值得注意的是"),
    ("综上所述", "综上所述"),
    ("总的来说", "总的来说"),
    ("简单来说", "简单来说"),
    ("不是分歧", "不是分歧"),
    ("第N轮", r"第\s*[一二三四五六七八九十\d]+\s*轮"),
    ("it's worth noting", r"(?i)it'?s worth noting"),
    ("importantly", r"(?i)\bimportantly\b"),
    ("delve", r"(?i)\bdelv(e|es|ing)\b"),
    ("leverage", r"(?i)\bleverag(e|es|ing)\b"),
    ("in summary", r"(?i)\bin summary\b"),
    ("round N", r"(?i)\bround\s+\d+\b"),
];

/// `evidence[].where` is exempt on purpose: it is a verbatim locator (see TS lintTaskHumanSummary).
pub fn lint_summary(summary: &SummaryContent) -> Vec<String> {
    let mut corpus = vec![
        summary.what.as_str(),
        summary.where_now.as_str(),
        summary.blocked_next.as_str(),
    ];
    corpus.extend(summary.evidence.iter().map(|e| e.label.as_str()));
    let corpus = corpus.join("\n");
    BANNED_PATTERNS
        .iter()
        .filter(|(_, pattern)| {
            Regex::new(pattern)
                .map(|re| re.is_match(&corpus))
                .unwrap_or(false)
        })
        .map(|(id, _)| (*id).to_string())
        .collect()
}

// ─── Response parsing (same tolerance as TS parseTaskHumanSummaryResponse) ───

#[derive(Debug, Deserialize)]
struct LooseSummary {
    what: Option<String>,
    #[serde(rename = "where")]
    where_now: Option<String>,
    #[serde(rename = "blockedNext")]
    blocked_next: Option<String>,
    blocked_next_snake: Option<String>,
    evidence: Option<Vec<serde_json::Value>>,
}

fn coerce_summary(value: serde_json::Value) -> Option<SummaryContent> {
    let mut loose: LooseSummary = serde_json::from_value(value.clone()).ok()?;
    if loose.blocked_next.is_none() {
        loose.blocked_next_snake = value
            .get("blocked_next")
            .and_then(|v| v.as_str())
            .map(str::to_string);
    }
    let what = non_empty(loose.what)?;
    let where_now = non_empty(loose.where_now)?;
    let blocked_next = non_empty(loose.blocked_next.or(loose.blocked_next_snake))?;
    let evidence = loose
        .evidence
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| {
            let label = non_empty(item.get("label")?.as_str().map(str::to_string))?;
            let location = item
                .get("where")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .unwrap_or_default();
            Some(SummaryEvidence { label, location })
        })
        .collect();
    Some(SummaryContent {
        what,
        where_now,
        blocked_next,
        evidence,
    })
}

pub fn parse_summary_response(text: &str) -> Option<SummaryContent> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut candidates = vec![trimmed.to_string()];
    let fence_stripped = trimmed
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim()
        .to_string();
    candidates.push(fence_stripped);
    if let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}')) {
        if end > start {
            candidates.push(trimmed[start..=end].to_string());
        }
    }
    candidates
        .into_iter()
        .filter_map(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
        .find_map(coerce_summary)
}

// ─── Generation (one retry on lint hits, like TS generateTaskHumanSummary) ───

fn build_call_config() -> Result<AgentCallConfig, ServerError> {
    let api_key = env::var("ANTHROPIC_AUTH_TOKEN")
        .or_else(|_| env::var("ANTHROPIC_API_KEY"))
        .map_err(|_| {
            ServerError::Internal(
                "No API key found. Set ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY.".to_string(),
            )
        })?;
    let model = env::var("WORKSPACE_AGENT_MODEL")
        .or_else(|_| env::var("ANTHROPIC_MODEL"))
        .unwrap_or_else(|_| "claude-sonnet-4-20250514".to_string());
    Ok(AgentCallConfig {
        adapter: "anthropic".to_string(),
        base_url: env::var("ANTHROPIC_BASE_URL")
            .unwrap_or_else(|_| "https://api.anthropic.com".to_string()),
        api_key,
        model,
        max_turns: 1,
        max_tokens: 2_048,
        temperature: None,
        system_prompt: String::new(),
        env: Default::default(),
        timeout_secs: 180,
    })
}

async fn request_summary(
    caller: &AcpAgentCaller,
    config: &AgentCallConfig,
    prompt: &str,
) -> Result<SummaryContent, ServerError> {
    let response = caller
        .call(config, prompt)
        .await
        .map_err(ServerError::Internal)?;
    if !response.success {
        return Err(ServerError::Internal(
            response
                .error
                .unwrap_or_else(|| "Summarizer call failed".to_string()),
        ));
    }
    if response.content.trim().is_empty() {
        return Err(ServerError::Internal(
            "Summarizer returned an empty response".to_string(),
        ));
    }
    parse_summary_response(&response.content).ok_or_else(|| {
        ServerError::Internal("Summarizer response was not the expected JSON layout".to_string())
    })
}

pub async fn generate_record(
    task: &Task,
    language: SummaryLanguage,
) -> Result<SummaryRecord, ServerError> {
    let description = normalize_description(&task.objective);
    let facts = extract_facts(task);
    let description_hash = hash_task_description(&description);
    let config = build_call_config()?;
    let caller = AcpAgentCaller::new();

    let mut summary = request_summary(
        &caller,
        &config,
        &build_prompt(language, &facts, &description, &[]),
    )
    .await?;
    let mut lint_hits = lint_summary(&summary);
    if !lint_hits.is_empty() {
        let retry = request_summary(
            &caller,
            &config,
            &build_prompt(language, &facts, &description, &lint_hits),
        )
        .await?;
        let retry_hits = lint_summary(&retry);
        if retry_hits.len() <= lint_hits.len() {
            summary = retry;
            lint_hits = retry_hits;
        }
    }

    Ok(SummaryRecord {
        task_id: task.id.clone(),
        description_hash,
        language,
        model: config.model,
        generated_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        summary,
        lint_hits,
    })
}

// ─── Handlers ────────────────────────────────────────────────────────────────

fn build_response(
    task_id: &str,
    description_hash: &str,
    language: SummaryLanguage,
    record: Option<SummaryRecord>,
    cached: bool,
) -> SummaryResponse {
    let stale = record
        .as_ref()
        .map(|r| r.description_hash != description_hash)
        .unwrap_or(false);
    SummaryResponse {
        task_id: task_id.to_string(),
        description_hash: description_hash.to_string(),
        language,
        record,
        stale,
        cached,
    }
}

async fn load_task(state: &AppState, id: &str) -> Result<Task, ServerError> {
    state
        .task_store
        .get(id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Task {id} not found")))
}

/// GET /api/tasks/{id}/human-summary
pub async fn get_human_summary(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Query(query): Query<SummaryQuery>,
) -> Result<Json<SummaryResponse>, ServerError> {
    let language = SummaryLanguage::from_loose(query.language.as_deref());
    let task = load_task(&state, &id).await?;
    let description_hash = hash_task_description(&task.objective);
    let record = FileSummaryStore::default_location()
        .get(&id, language)
        .await;
    let cached = record.is_some();
    Ok(Json(build_response(
        &id,
        &description_hash,
        language,
        record,
        cached,
    )))
}

/// POST /api/tasks/{id}/human-summary
pub async fn post_human_summary(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    body: Option<Json<SummaryPostBody>>,
) -> Result<Json<SummaryResponse>, ServerError> {
    let body = body.map(|Json(b)| b).unwrap_or_default();
    let language = SummaryLanguage::from_loose(body.language.as_deref());
    let force = body.force.unwrap_or(false);
    let task = load_task(&state, &id).await?;
    let store = FileSummaryStore::default_location();
    let description_hash = hash_task_description(&task.objective);

    if !force {
        if let Some(existing) = store.get(&id, language).await {
            if existing.description_hash == description_hash {
                return Ok(Json(build_response(
                    &id,
                    &description_hash,
                    language,
                    Some(existing),
                    true,
                )));
            }
        }
    }

    let record = generate_record(&task, language).await?;
    store.save(&record).await?;
    Ok(Json(build_response(
        &id,
        &description_hash,
        language,
        Some(record),
        false,
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_task(title: &str, objective: &str) -> Task {
        Task::new(
            "task-1".to_string(),
            title.to_string(),
            objective.to_string(),
            "workspace-1".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
    }

    fn sample_summary() -> SummaryContent {
        SummaryContent {
            what: "复走查两个错误场景并替换母卡证据。".into(),
            where_now: "卡片在 review 列，等待前置卡落地。".into(),
            blocked_next: "两张前置卡进入 done 后，由 Backlog 阶段回流细化。".into(),
            evidence: vec![SummaryEvidence {
                label: "AC1 五项断言".into(),
                location: "acceptance_criteria AC1".into(),
            }],
        }
    }

    // Vectors produced by the TS side:
    //   node --input-type=module -e 'import {createHash} from "node:crypto"; ...'
    // (see docs/exec-plans/completed/human-summary-rust-endpoint.md)
    #[test]
    fn hash_matches_typescript_vectors() {
        let heavy = "承接自母卡 `d5e0a0a2`。\n\n## 第二轮 Backlog 梳理\n\n```yaml\nstory:\n  title: \"x\"\n```\n";
        assert_eq!(
            hash_task_description(heavy),
            "9018a4e24ec4c707b79253c303dd3fcb16b546e928f43eb1397e2551c094c6c3"
        );
        assert_eq!(
            hash_task_description("  a\r\nb\n"),
            "7e18f737311b2dc3b2f269dd78396b0351f14fb66efa879f768cb23181883c78"
        );
        assert_eq!(
            hash_task_description(""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            hash_task_description("a\r\nb"),
            hash_task_description("  a\nb\n")
        );
    }

    #[test]
    fn lint_catches_banned_phrases_and_exempts_evidence_where() {
        let dirty = SummaryContent {
            what: "值得注意的是，这张卡要做走查。".into(),
            where_now: "第二轮梳理已完成，综上所述还差一步。".into(),
            blocked_next: "Importantly, round 3 will delve into it.".into(),
            evidence: vec![SummaryEvidence {
                label: "总的来说，这不是分歧".into(),
                location: "x".into(),
            }],
        };
        let hits = lint_summary(&dirty);
        for expected in [
            "值得注意的是",
            "综上所述",
            "总的来说",
            "不是分歧",
            "第N轮",
            "importantly",
            "delve",
            "round N",
        ] {
            assert!(
                hits.iter().any(|h| h == expected),
                "missing hit {expected}: {hits:?}"
            );
        }

        let mut clean = sample_summary();
        clean.evidence = vec![SummaryEvidence {
            label: "场景⑧的三个前端出口".into(),
            location: "第二轮 Backlog 梳理 → 二、本轮新发现 → 表格".into(),
        }];
        assert!(lint_summary(&clean).is_empty());
    }

    #[test]
    fn parses_raw_fenced_and_wrapped_json_and_snake_case() {
        let json = serde_json::to_string(&sample_summary()).unwrap();
        assert_eq!(parse_summary_response(&json), Some(sample_summary()));
        assert_eq!(
            parse_summary_response(&format!("```json\n{json}\n```")),
            Some(sample_summary())
        );
        assert_eq!(
            parse_summary_response(&format!("Here you go:\n{json}\nThanks.")),
            Some(sample_summary())
        );
        let snake = r#"{"what":"a","where":"b","blocked_next":"c","evidence":[{"label":"ok","where":"x"},{"where":"no label"},"junk"]}"#;
        let parsed = parse_summary_response(snake).unwrap();
        assert_eq!(parsed.blocked_next, "c");
        assert_eq!(parsed.evidence.len(), 1);
        assert!(parse_summary_response(r#"{"what":"a","where":"b"}"#).is_none());
        assert!(parse_summary_response("not json").is_none());
    }

    #[test]
    fn file_store_round_trips_and_tolerates_corruption() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileSummaryStore::new(dir.path().to_path_buf());
        let record = SummaryRecord {
            task_id: "task/with:odd chars".into(),
            description_hash: "abc".into(),
            language: SummaryLanguage::ZhCn,
            model: "m".into(),
            generated_at: "2026-09-22T00:00:00.000Z".into(),
            summary: sample_summary(),
            lint_hits: vec![],
        };
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            assert!(store
                .get(&record.task_id, SummaryLanguage::ZhCn)
                .await
                .is_none());
            store.save(&record).await.unwrap();
            assert_eq!(
                store.get(&record.task_id, SummaryLanguage::ZhCn).await,
                Some(record.clone())
            );
            assert!(store
                .get(&record.task_id, SummaryLanguage::En)
                .await
                .is_none());
            let files: Vec<_> = std::fs::read_dir(dir.path()).unwrap().collect();
            assert_eq!(files.len(), 1);
            let path = files[0].as_ref().unwrap().path();
            assert_eq!(
                path.file_name().unwrap().to_str().unwrap(),
                "task_with_odd_chars.zh-CN.json"
            );
            std::fs::write(&path, "{not json").unwrap();
            assert!(store
                .get(&record.task_id, SummaryLanguage::ZhCn)
                .await
                .is_none());
        });
    }

    #[test]
    fn extracts_facts_from_canonical_yaml_and_degrades_for_plain_text() {
        let objective = "Intro.\n\n## 第二轮 Backlog 梳理\n\n## ⚠️ 本卡为「据实阻塞」卡\n\n```yaml\nstory:\n  title: \"Real title\"\n  acceptance_criteria:\n    - id: AC1\n      text: \"one\"\n      testable: true\n    - id: AC2\n      text: \"two\"\n      testable: true\n  dependencies_and_sequencing:\n    independent_story_check: fail\n    depends_on:\n      - \"5cea679a\"\n    unblock_condition: \"upstream done\"\n  invest:\n    independent:\n      status: fail\n      reason: \"depends on upstream\"\n```\n";
        let mut task = make_task("fallback", objective);
        task.column_id = Some("review".into());
        let facts = extract_facts(&task);
        assert_eq!(facts.title, "Real title");
        assert_eq!(facts.lane_id, "review");
        assert_eq!(
            facts.acceptance_criteria,
            vec![
                ("AC1".to_string(), "one".to_string()),
                ("AC2".to_string(), "two".to_string())
            ]
        );
        assert_eq!(facts.block_reason.as_deref(), Some("depends on upstream"));
        assert_eq!(facts.depends_on, vec!["5cea679a".to_string()]);
        assert_eq!(facts.unblock_condition.as_deref(), Some("upstream done"));
        assert_eq!(
            facts.section_headings,
            vec![
                "第二轮 Backlog 梳理".to_string(),
                "⚠️ 本卡为「据实阻塞」卡".to_string()
            ]
        );

        let legacy = make_task("Legacy", "Just one sentence.");
        let facts = extract_facts(&legacy);
        assert_eq!(facts.title, "Legacy");
        assert_eq!(facts.lane_id, "backlog");
        assert!(facts.acceptance_criteria.is_empty());
        assert!(facts.block_reason.is_none());
        assert!(facts.section_headings.is_empty());
    }

    #[test]
    fn prompt_embeds_facts_description_and_retry_note() {
        let facts = SummaryFacts {
            title: "T".into(),
            lane_id: "review".into(),
            acceptance_criteria: vec![("AC1".into(), "场景 ⑧ 复走查".into())],
            ..Default::default()
        };
        let prompt = build_prompt(SummaryLanguage::ZhCn, &facts, "desc", &[]);
        assert!(prompt.contains("值得注意的是、综上所述、总的来说"));
        assert!(prompt.contains("- AC1: 场景 ⑧ 复走查"));
        assert!(prompt.contains("<<<DESCRIPTION\ndesc\nDESCRIPTION>>>"));
        assert!(!prompt.contains("上一版命中了黑名单"));
        let retry = build_prompt(SummaryLanguage::ZhCn, &facts, "desc", &["综上所述".into()]);
        assert!(retry.contains("上一版命中了黑名单：综上所述"));
    }
}
