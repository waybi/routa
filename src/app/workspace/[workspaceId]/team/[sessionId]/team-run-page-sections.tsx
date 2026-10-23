"use client";

import React from "react";
import { useTranslation } from "@/i18n";
import { useState } from "react";
import { MessageBubble } from "@/client/components/message-bubble";
import { Badge } from "@/client/components/ui/badge";
import type { ChatMessage } from "@/client/components/chat-panel/types";
import { AskUserQuestionBubble } from "@/client/components/message-bubble";
import {
  deliverableKindLabel,
  deliverableStatusLabel,
  memberStatusLabel,
  taskStatusLabel,
} from "../team-status-labels";
import {
  roleAvatarClass,
  roleChipClass,
  type DeliverableItem,
  type NormalizedTaskStatus,
  type TeamMemberItem,
  type TeamMemberStatus,
  type TeamTaskNode,
  type SessionLaneItem,
} from "./team-run-page-model";
import { Check, Eye, Info } from "lucide-react";


export function ObjectiveSidebarSection({
  objective,
  taskTree,
  deliverables,
  onFocusSession,
}: {
  objective: string;
  taskTree: TeamTaskNode[];
  deliverables: DeliverableItem[];
  onFocusSession: (sessionId: string) => void;
}) {
  const { t } = useTranslation();
  const [isObjectiveExpanded, setIsObjectiveExpanded] = useState(false);
  const shouldClampObjective = objective.length > 96;
  const canToggleObjective = shouldClampObjective;
  const objectiveClassName = shouldClampObjective && !isObjectiveExpanded ? "line-clamp-3" : "";
  return (
    <section className="flex min-h-0 flex-col rounded-lg border border-default bg-subtle" data-testid="team-run-evidence">
      <div className="border-b border-default px-2.5 py-1.5">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-[12px] font-semibold text-secondary">
            {t.team.objective}
          </h2>
          {canToggleObjective ? (
            <button
              type="button"
              onClick={() => setIsObjectiveExpanded((current) => !current)}
              className="rounded-control text-[10px] font-medium text-accent transition hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {isObjectiveExpanded ? t.team.showLessThread : t.team.expandThread}
            </button>
          ) : null}
        </div>
        <div className={`mt-1 text-xs leading-5 text-primary [overflow-wrap:anywhere] ${objectiveClassName}`}>
          {objective || t.team.noObjective}
        </div>
      </div>

      <div className="border-b border-default px-2.5 py-1.5">
        <div className="text-[11px] font-semibold text-secondary">
          {t.team.planTaskTree}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-1.5">
        <div className="space-y-2">
          {taskTree.length === 0 ? (
            <EmptyPanel message={t.team.noTaskNotesYet} />
          ) : (
            <div className="space-y-1.5">
              {taskTree.map((node) => <TaskTreeNode key={node.id} node={node} onFocusSession={onFocusSession} />)}
            </div>
          )}

          <div className="border-t border-default pt-2">
            <div className="px-1 pb-1.5 text-[10px] font-semibold text-secondary">
              {t.team.deliverables}
            </div>
            {deliverables.length === 0 ? (
              <EmptyPanel message={t.team.noNotesOrDeliverablesYet} />
            ) : (
              <div className="divide-y divide-default rounded-[10px] border border-default bg-surface">
                {deliverables.map((item) => {
                  const kind = deliverableKindLabel(t.teamRedesign, item.label);
                  const status = deliverableStatusLabel(t.teamRedesign, item.status);
                  return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => item.sessionId && onFocusSession(item.sessionId)}
                    disabled={!item.sessionId}
                    className={`flex w-full items-start gap-2 px-2.5 py-2 text-left transition focus-visible:outline-2 focus-visible:outline-accent ${item.sessionId ? "hover:bg-hover" : "cursor-default"
                      }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="break-words text-[11px] font-semibold text-primary">{kind.known ? kind.label : item.label}</div>
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </div>
                      <div className="mt-0.5 truncate text-[10px] text-secondary">{item.title}</div>
                      <div className="mt-0.5 text-[9px] text-secondary">{item.owner}</div>
                      {item.summary && (
                        <div className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-secondary">{item.summary}</div>
                      )}
                    </div>
                  </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export function SessionTimelineSection({
  leadMessages,
  memberLaneByToolCallId,
  sessionLanes,
  selectedSessionId,
  onSelectSession,
  onOpenViewer,
  onSubmitQuestion,
  sessionBlockRef,
}: {
  leadMessages: ChatMessage[];
  memberLaneByToolCallId: Map<string, SessionLaneItem>;
  sessionLanes: Array<{ sessionId: string }>;
  selectedSessionId?: string;
  onSelectSession: (sessionId: string) => void;
  onOpenViewer: (sessionId: string) => void;
  onSubmitQuestion?: (sessionId: string, toolCallId: string, response: Record<string, unknown>) => Promise<void>;
  sessionBlockRef: (sessionId: string, node: HTMLDivElement | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface">
      <div className="border-b border-default px-3 py-1.5">
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div>
            <h2 className="text-[11px] font-semibold text-secondary">
              {t.team.sessionTimeline}
            </h2>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-secondary">
            <span className="rounded-full border border-default bg-subtle px-2 py-0.5">
              {leadMessages.length} {t.team.messages}
            </span>
            <span className="rounded-full border border-default bg-subtle px-2 py-0.5">
              {Math.max(sessionLanes.length - 1, 0)} {t.team.membersCount}
            </span>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-1.5">
        {leadMessages.length === 0 ? (
          <EmptyPanel message={t.team.noLeadTimelineYet} />
        ) : (
          <div className="space-y-1.5">
            {leadMessages.map((message, index) => {
              const lane = message.toolCallId ? memberLaneByToolCallId.get(message.toolCallId) : undefined;
              return (
                <LeadMessageThread
                  key={`${message.id}-${index}`}
                  message={message}
                  lane={lane}
                  activeSessionId={selectedSessionId}
                  sessionBlockRef={lane ? (node) => sessionBlockRef(lane.sessionId, node) : undefined}
                  onSelectSession={lane ? () => onSelectSession(lane.sessionId) : undefined}
                  onOpenViewer={lane ? () => onOpenViewer(lane.sessionId) : undefined}
                  onSubmitQuestion={onSubmitQuestion}
                />
              );
            })}
          </div>
        )}
      </div>
    </section >
  );
}

export function TeamMembersSection({
  teamMembers,
  selectedSessionId,
  onFocusSession,
}: {
  teamMembers: TeamMemberItem[];
  selectedSessionId?: string;
  onFocusSession: (sessionId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="min-h-0 overflow-hidden rounded-lg border border-default bg-subtle" aria-label={t.teamRedesign.session.membersTitle}>
      <div className="border-b border-default px-2.5 py-1.5">
        <h2 className="m-0 text-[11px] font-semibold text-secondary">
          {t.teamRedesign.session.membersTitle}
        </h2>
      </div>

      <div className="min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="divide-y divide-default">
            {teamMembers.map((member) => {
              const isSelected = member.sessionId === selectedSessionId;
              const status = memberStatusLabel(t.teamRedesign, member.status);
              return (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => member.sessionId && onFocusSession(member.sessionId)}
                  disabled={!member.sessionId}
                  data-testid="team-member-item"
                  className={`flex w-full items-start gap-2 px-2.5 py-1.5 text-left transition focus-visible:outline-2 focus-visible:outline-accent ${isSelected
                    ? "bg-accent-subtle"
                    : member.sessionId
                      ? "hover:bg-hover"
                      : "opacity-75"
                    }`}
                >
                  <div className={`relative mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${roleAvatarClass(member.roleId)}`}>
                    {member.avatarLabel}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="break-words text-[11px] font-semibold text-primary">{member.actor}</div>
                      <Badge tone={status.tone} className="shrink-0">{status.label}</Badge>
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-secondary">
                      {member.sessionId ? member.roleLabel : `${member.roleLabel} · ${t.team.noSessionYet}`}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 text-[10px] text-secondary">
                      <span>{member.lastUpdatedLabel ?? t.team.waitingForDelegation}</span>
                      {member.preview && (
                        <>
                          <span className="opacity-40">/</span>
                          <span className="truncate">{member.preview}</span>
                        </>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
function TaskTreeNode({
  node,
  level = 0,
  onFocusSession,
}: {
  node: TeamTaskNode;
  level?: number;
  onFocusSession: (sessionId: string) => void;
}) {
  const clickable = Boolean(node.sessionId);
  return (
    <div>
      <div
        className={`rounded-[10px] border border-transparent px-2 py-1.5 transition-colors hover:border-default hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent ${clickable ? "cursor-pointer" : ""}`}
        style={{ marginLeft: level * 12 }}
        role={clickable ? "button" : undefined}
        tabIndex={clickable ? 0 : undefined}
        data-testid="team-task-node"
        onClick={clickable ? () => onFocusSession(node.sessionId!) : undefined}
        onKeyDown={clickable ? (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onFocusSession(node.sessionId!);
          }
        } : undefined}
      >
        <div className="flex items-start gap-3">
          <div className="pt-0.5">
            <TaskStatusGlyph status={node.status} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <div className={`text-[13px] leading-5 ${node.status === "done" ? "text-secondary line-through" : "text-primary"}`}>
                {node.title}
              </div>
              <TaskStatusPill status={node.status} />
            </div>
            {node.details && (
              <div className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-secondary">
                {node.details}
              </div>
            )}
          </div>
        </div>
      </div>
      {node.children.map((child) => (
        <TaskTreeNode key={child.id} node={child} level={level + 1} onFocusSession={onFocusSession} />
      ))}
    </div>
  );
}

function TaskStatusGlyph({ status }: { status: NormalizedTaskStatus }) {
  if (status === "done") {
    return (
      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-success-subtle text-success">
        <Check className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}/>
      </div>
    );
  }
  if (status === "in-progress") {
    return <div className="h-5 w-5 rounded-full border-2 border-information border-t-transparent animate-spin" />;
  }
  if (status === "waiting-review") {
    return (
      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-attention-subtle text-attention">
        <Eye className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
      </div>
    );
  }
  if (status === "blocked") {
    return (
      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-danger-subtle text-danger">
        <Info className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
      </div>
    );
  }
  return <div className="h-5 w-5 rounded-full border-2 border-default" />;
}

function TaskStatusPill({ status }: { status: NormalizedTaskStatus }) {
  const { t } = useTranslation();
  const label = taskStatusLabel(t.teamRedesign, status);
  return <Badge tone={label.tone} className="shrink-0">{label.label}</Badge>;
}

function SessionStatusPill({ status }: { status: TeamMemberStatus }) {
  const { t } = useTranslation();
  const label = memberStatusLabel(t.teamRedesign, status);
  return <Badge tone={label.tone}>{label.label}</Badge>;
}

function LeadMessageThread({
  message,
  lane,
  activeSessionId,
  sessionBlockRef,
  onSelectSession,
  onOpenViewer,
  onSubmitQuestion,
}: {
  message: ChatMessage;
  lane?: SessionLaneItem;
  activeSessionId?: string;
  sessionBlockRef?: (node: HTMLDivElement | null) => void;
  onSelectSession?: () => void;
  onOpenViewer?: () => void;
  onSubmitQuestion?: (sessionId: string, toolCallId: string, response: Record<string, unknown>) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const isActive = lane?.sessionId === activeSessionId;
  const previewLaneMessage = lane?.messages.at(-1);
  const previewText = typeof previewLaneMessage?.content === "string"
    ? previewLaneMessage.content.replace(/\s+/g, " ").trim()
    : "";
  const pendingQuestionMessage = lane?.pendingQuestion ? {
    id: `${lane.pendingQuestion.sessionId}-${lane.pendingQuestion.toolCallId}`,
    role: "tool",
    content: "AskUserQuestion",
    timestamp: new Date(),
    toolName: "AskUserQuestion",
    toolStatus: "awaiting_input",
    toolCallId: lane.pendingQuestion.toolCallId,
    toolKind: "ask-user-question",
    toolRawInput: {
      questions: lane.pendingQuestion.questions,
      answers: lane.pendingQuestion.answers,
    },
  } satisfies ChatMessage : null;

  return (
    <div className="space-y-1">
      <div>
        <MessageBubble message={message} />
      </div>

      {lane && (
        <div
          ref={sessionBlockRef}
          className={`ml-6 rounded-r-[10px] border-l-2 pl-3 ${isActive ? "border-information bg-accent-subtle" : "border-default/80"}`}
        >
          <div className="flex items-center justify-between gap-2 py-1">
            <div className="min-w-0 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={onSelectSession}
                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition focus-visible:outline-2 focus-visible:outline-accent ${roleChipClass(lane.roleId)}`}
              >
                {lane.actor}
              </button>
              {lane.roleLabel && (
                <span className="rounded-full border border-default bg-surface px-2 py-0.5 text-[10px] text-secondary">
                  {lane.roleLabel}
                </span>
              )}
              <SessionStatusPill status={lane.status} />
              <span className="text-[10px] text-secondary">{lane.lastUpdatedLabel}</span>
              <span className="text-[10px] text-secondary opacity-40">/</span>
              <span className="text-[10px] text-secondary">{lane.eventCount} {t.team.updates}</span>
            </div>
                <button
                  type="button"
                  onClick={onOpenViewer}
                  className="rounded-control text-[10px] font-medium text-secondary transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-accent"
                >
                  {t.team.openViewer}
                </button>
          </div>

          <div className="space-y-1 py-0.5">
            {lane.messages.length === 0 ? (
              <div className="text-[11px] text-secondary">{t.team.noTranscriptYet}</div>
            ) : !expanded && previewLaneMessage ? (
              <>
                <div className="rounded-[10px] border border-default bg-surface px-2.5 py-1.5 text-[11px] leading-5 text-secondary line-clamp-2">
                  {previewText || t.team.openThisThread}
                </div>
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  className="text-[10px] font-medium text-secondary transition-colors hover:text-primary"
                >
                  {t.team.expandThread}
                </button>
              </>
            ) : (
              <>
                {lane.messages.map((laneMessage, index) => (
                  <div key={`${laneMessage.id}-${index}`} className="[&_button]:text-[11px] [&_.markdown-body]:text-[11px] [&_.markdown-body]:leading-5">
                    <MessageBubble message={laneMessage} />
                  </div>
                ))}
                {lane.messages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setExpanded(false)}
                    className="text-[10px] font-medium text-secondary transition-colors hover:text-primary"
                  >
                    {t.team.showLessThread}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {pendingQuestionMessage && onSubmitQuestion && lane?.pendingQuestion && (
        <div className="ml-6 border-l-2 border-default/80 pl-3 pt-1.5">
            <div className="mb-1.5 text-[10px] font-semibold text-secondary">
              {t.team.awaitingInput}
            </div>
          <AskUserQuestionBubble
            message={pendingQuestionMessage}
            onSubmit={(toolCallId, response) => onSubmitQuestion(lane.pendingQuestion!.sessionId, toolCallId, response)}
          />
        </div>
      )}
    </div>
  );
}

function EmptyPanel({ message }: { message: string }) {
  return (
    <div className="rounded-[16px] border border-dashed border-default px-3 py-5 text-center text-sm text-secondary">
      {message}
    </div>
  );
}
