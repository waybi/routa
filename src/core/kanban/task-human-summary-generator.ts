import {
  buildTaskHumanSummaryPrompt,
  extractTaskHumanSummaryFacts,
  lintTaskHumanSummary,
  normalizeTaskDescription,
  parseTaskHumanSummaryResponse,
  type TaskHumanSummaryContent,
  type TaskHumanSummaryLanguage,
  type TaskHumanSummaryRecord,
} from "./task-human-summary";
import { hashTaskDescription } from "./task-human-summary-store";

/**
 * Generates the LLM half of the human-readable summary.
 *
 * The model call is injected so the retry / lint / parse loop is unit-testable and the
 * route stays free of provider details. The default caller uses the workspace-agent
 * provider config (WORKSPACE_AGENT_PROVIDER / WORKSPACE_AGENT_MODEL) with a plain
 * `generateText`: one shot, no tools.
 */
export interface TaskHumanSummaryTextGenerator {
  (prompt: string): Promise<{ text: string; model: string }>;
}

export interface GenerateTaskHumanSummaryInput {
  taskId: string;
  title: string;
  objective?: string | null;
  columnId?: string | null;
  language: TaskHumanSummaryLanguage;
}

export class TaskHumanSummaryGenerationError extends Error {
  constructor(message: string, readonly code: "empty_response" | "unparseable" | "provider") {
    super(message);
    this.name = "TaskHumanSummaryGenerationError";
  }
}

const SUMMARY_MAX_TOKENS = 2_048;

export async function createDefaultTaskHumanSummaryTextGenerator(): Promise<TaskHumanSummaryTextGenerator> {
  const [{ generateText }, { createLanguageModel, resolveWorkspaceAgentConfig }] = await Promise.all([
    import("ai"),
    import("../acp/workspace-agent/workspace-agent-config"),
  ]);
  const config = resolveWorkspaceAgentConfig({ maxTokens: SUMMARY_MAX_TOKENS });
  const model = await createLanguageModel(config);
  return async (prompt: string) => {
    const result = await generateText({
      model,
      prompt,
      maxOutputTokens: config.maxTokens,
    });
    return { text: result.text, model: config.modelId };
  };
}

async function requestSummary(
  generate: TaskHumanSummaryTextGenerator,
  prompt: string,
): Promise<{ summary: TaskHumanSummaryContent; model: string }> {
  let response: { text: string; model: string };
  try {
    response = await generate(prompt);
  } catch (error) {
    throw new TaskHumanSummaryGenerationError(
      error instanceof Error ? error.message : String(error),
      "provider",
    );
  }
  if (!response.text.trim()) {
    throw new TaskHumanSummaryGenerationError("Summarizer returned an empty response", "empty_response");
  }
  const summary = parseTaskHumanSummaryResponse(response.text);
  if (!summary) {
    throw new TaskHumanSummaryGenerationError("Summarizer response was not the expected JSON layout", "unparseable");
  }
  return { summary, model: response.model };
}

/**
 * Generate once; if the banned-phrase lint hits, retry exactly once with the hits fed back.
 * The second draft is kept even if it still has hits (reported in `lintHits`) so the UI can flag it
 * rather than leaving the reader with nothing.
 */
export async function generateTaskHumanSummary(
  input: GenerateTaskHumanSummaryInput,
  generate: TaskHumanSummaryTextGenerator,
  now: () => Date = () => new Date(),
): Promise<TaskHumanSummaryRecord> {
  const description = normalizeTaskDescription(input.objective);
  const facts = extractTaskHumanSummaryFacts(input);
  const descriptionHash = hashTaskDescription(description);

  const first = await requestSummary(
    generate,
    buildTaskHumanSummaryPrompt({ language: input.language, facts, description }),
  );
  let summary = first.summary;
  let model = first.model;
  let lintHits = lintTaskHumanSummary(summary);

  if (lintHits.length > 0) {
    const retry = await requestSummary(
      generate,
      buildTaskHumanSummaryPrompt({ language: input.language, facts, description, previousLintHits: lintHits }),
    );
    const retryHits = lintTaskHumanSummary(retry.summary);
    if (retryHits.length <= lintHits.length) {
      summary = retry.summary;
      model = retry.model;
      lintHits = retryHits;
    }
  }

  return {
    taskId: input.taskId,
    descriptionHash,
    language: input.language,
    model,
    generatedAt: now().toISOString(),
    summary,
    lintHits,
  };
}
