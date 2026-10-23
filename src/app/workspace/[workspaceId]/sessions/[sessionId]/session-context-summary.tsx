"use client";

import Link from "next/link";

import { PropertyRow } from "@/client/components/ui/property-row";
import { StatusDot, type Tone } from "@/client/components/ui/badge";
import { buttonClassName } from "@/client/components/ui/button";
import { useTranslation } from "@/i18n";

export type SessionRunStatus = "running" | "idle" | "connecting" | "error" | "unknown";

export interface SessionContextSummaryProps {
  workspaceId: string;
  workspaceName?: string | null;
  provider?: string | null;
  branch?: string | null;
  status: SessionRunStatus;
}

/**
 * Resolve the status row from what is actually known: the chat column's
 * run state first, then the session record's ACP status. Anything else is
 * "unknown" (shown as 未确认) rather than a guess.
 */
export function resolveSessionRunStatus(
  chatRunning: boolean | null,
  acpStatus: "connecting" | "ready" | "error" | undefined | null,
): SessionRunStatus {
  if (chatRunning === true) return "running";
  if (acpStatus === "error") return "error";
  if (acpStatus === "connecting") return "connecting";
  if (acpStatus === "ready" && chatRunning === false) return "idle";
  return "unknown";
}

const STATUS_TONE: Record<SessionRunStatus, Tone> = {
  running: "info",
  idle: "neutral",
  connecting: "attention",
  error: "danger",
  unknown: "neutral",
};

/** Prototype right column: "会话上下文" and "相关入口" panels. */
export function SessionContextSummary({ workspaceId, workspaceName, provider, branch, status }: SessionContextSummaryProps) {
  const { t } = useTranslation();
  const copy = t.sessionDetailRedesign.context;
  const statusLabel: Record<SessionRunStatus, string> = {
    running: copy.statusRunning,
    idle: copy.statusIdle,
    connecting: copy.statusConnecting,
    error: copy.statusError,
    unknown: copy.statusUnknown,
  };
  const unknown = copy.statusUnknown;

  return (
    <div data-testid="session-context-summary" className="grid gap-3 px-3 py-3">
      <section aria-label={copy.title}>
        <p className="m-0 mb-1 text-xs font-semibold text-primary">{copy.title}</p>
        <dl className="m-0">
          <PropertyRow label={copy.workspace}>
            <span data-testid="session-context-workspace">{workspaceName || workspaceId}</span>
          </PropertyRow>
          <PropertyRow label={copy.provider}>
            <span data-testid="session-context-provider">{provider || unknown}</span>
          </PropertyRow>
          {branch ? (
            <PropertyRow label={copy.branch} mono>
              <span data-testid="session-context-branch">{branch}</span>
            </PropertyRow>
          ) : null}
          <PropertyRow label={copy.status}>
            <span data-testid="session-context-status" data-status={status}>
              <StatusDot tone={STATUS_TONE[status]} label={statusLabel[status]} pulse={status === "running"} />
            </span>
          </PropertyRow>
        </dl>
      </section>
      <section aria-label={copy.linksTitle}>
        <p className="m-0 mb-2 text-xs font-semibold text-primary">{copy.linksTitle}</p>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/traces?workspaceId=${encodeURIComponent(workspaceId)}`}
            data-testid="session-context-link-traces"
            className={buttonClassName("secondary", "sm")}
          >
            {copy.traces}
          </Link>
          <Link href="/debug/acp-replay" data-testid="session-context-link-replay" className={buttonClassName("secondary", "sm")}>
            {copy.acpReplay}
          </Link>
        </div>
      </section>
    </div>
  );
}
