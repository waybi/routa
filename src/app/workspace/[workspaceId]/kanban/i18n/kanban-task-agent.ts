import kanbanPromptTemplates from "@/../resources/specialists/workflows/kanban/prompts/templates.json";
import type { KanbanSpecialistLanguage } from "../kanban-specialist-language";

export interface KanbanTaskAgentCopy {
  [key: string]: string;
  providerAriaLabel: string;
  placeholder: string;
  connectingPlaceholder: string;
  send: string;
  manual: string;
  view: string;
  openPanelTitle: string;
  panelTitle: string;
  open: string;
  close: string;
  modelEffortAriaLabel: string;
  modelEffortDefault: string;
  modelEffortHint: string;
  modelEffortUnsupported: string;
}

const KANBAN_TASK_AGENT_COPY: Record<KanbanSpecialistLanguage, KanbanTaskAgentCopy> = {
  en: {
    providerAriaLabel: "KanbanTask Agent provider",
    placeholder: "Describe work to plan in Kanban...",
    connectingPlaceholder: "Connecting...",
    send: "Send",
    manual: "Manual",
    view: "View",
    openPanelTitle: "Open the KanbanTask Agent panel",
    panelTitle: "KanbanTask Agent",
    open: "Open",
    close: "Close",
    modelEffortAriaLabel: "KanbanTask Agent model and reasoning effort",
    modelEffortDefault: "Default",
    modelEffortHint: "Model and reasoning effort for the next KanbanTask Agent session; leave empty to follow the provider default.",
    modelEffortUnsupported: "This provider lists no model or reasoning effort options; the session uses its default.",
  },
  "zh-CN": {
    providerAriaLabel: "看板任务代理 provider",
    placeholder: "描述要在 Kanban 中规划的工作...",
    connectingPlaceholder: "连接中...",
    send: "发送",
    manual: "手动创建",
    view: "查看",
    openPanelTitle: "打开看板任务代理面板",
    panelTitle: "看板任务代理",
    open: "打开",
    close: "关闭",
    modelEffortAriaLabel: "看板任务代理的模型与推理档位",
    modelEffortDefault: "默认",
    modelEffortHint: "下一次派单新建看板任务代理会话时用的模型和推理档位；留空跟随 provider 默认。",
    modelEffortUnsupported: "这个 provider 没有提供模型或推理档位选项，会话按默认设置运行。",
  },
};

type PromptTemplateCatalog = typeof kanbanPromptTemplates;
type PromptTemplateKey = keyof PromptTemplateCatalog;

function renderPromptTemplate(
  key: PromptTemplateKey,
  language: KanbanSpecialistLanguage,
  values: Record<string, string>,
): string {
  const lines = kanbanPromptTemplates[key][language];
  return lines
    .join("\n")
    .replace(/\{\{(\w+)\}\}/g, (_match, token: string) => values[token] ?? "");
}

export function getKanbanTaskAgentCopy(language: KanbanSpecialistLanguage): KanbanTaskAgentCopy {
  return KANBAN_TASK_AGENT_COPY[language];
}

export function buildKanbanTaskAgentPrompt(params: {
  workspaceId: string;
  boardId?: string | null;
  repoPath?: string;
  agentInput: string;
  language?: KanbanSpecialistLanguage;
}): string {
  const { workspaceId, boardId, repoPath, agentInput, language = "en" } = params;

  return renderPromptTemplate("taskAgent", language, {
    workspaceId,
    boardId: boardId ?? "default",
    repoPath: repoPath ?? "not configured",
    agentInput,
  });
}

export function buildKanbanMoveBlockedRemediationPrompt(params: {
  workspaceId: string;
  boardId?: string | null;
  cardId: string;
  cardTitle: string;
  targetColumnId: string;
  repoPath?: string;
  missingFields: string[];
  language?: KanbanSpecialistLanguage;
}): string {
  const {
    workspaceId,
    boardId,
    cardId,
    cardTitle,
    targetColumnId,
    repoPath,
    missingFields,
    language = "en",
  } = params;
  const missingList = missingFields.length > 0 ? missingFields.join(", ") : "scope, acceptance criteria, verification plan";

  return renderPromptTemplate("moveBlockedRemediation", language, {
    workspaceId,
    boardId: boardId ?? "default",
    repoPath: repoPath ?? "not configured",
    cardId,
    cardTitle,
    targetColumnId,
    missingList,
  });
}

/**
 * Wraps a follow-up question typed into the card-detail session panel with
 * writing rules for the reply.
 *
 * The panel talks to an agent whose system prompt was written for *doing*
 * the card (planning, coding, verifying), so its answers to a human's
 * follow-up question tend to read like a work log: chronological, hedged,
 * padded. The rules here (ported from the RunAI Coder base instructions)
 * push the reply toward the shape a person reading a side panel wants —
 * outcome first, evidence they can check, plain words.
 *
 * Only the human's typed message is wrapped; the card's system prompt and
 * the agent's tool access are unchanged.
 */
export function buildKanbanHumanReadableReplyPrompt(params: {
  request: string;
  language?: KanbanSpecialistLanguage;
}): string {
  const { request, language = "en" } = params;
  return renderPromptTemplate("humanReadableReply", language, { request });
}
