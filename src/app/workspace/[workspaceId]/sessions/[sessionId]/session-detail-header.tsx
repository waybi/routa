"use client";

import type { ReactNode } from "react";

import { Badge } from "@/client/components/ui/badge";
import { useTranslation } from "@/i18n";

export interface SessionDetailHeaderProps {
  /** Small label above the title, e.g. "施工会话" / "团队会话". */
  eyebrow: ReactNode;
  title: ReactNode;
  sessionId: string;
  model?: string | null;
  role?: string | null;
  provider?: string | null;
  actions?: ReactNode;
  testId?: string;
}

/**
 * Shared header for the session detail and team session pages
 * (design-spec §3 rows 6 and 8, prototype `sessionPage()`): page label,
 * session title that wraps instead of truncating, then ID / model / role
 * badges. The model badge says "not recorded" rather than inventing one.
 */
export function SessionDetailHeader({
  eyebrow,
  title,
  sessionId,
  model,
  role,
  provider,
  actions,
  testId = "session-detail-header",
}: SessionDetailHeaderProps) {
  const { t } = useTranslation();
  const copy = t.sessionsRedesign;

  return (
    <header data-testid={testId} className="shrink-0 border-b border-default bg-canvas px-4 py-4 md:px-[22px] xl:px-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="m-0 text-xs text-secondary">{eyebrow}</p>
          <h1 className="m-0 mt-0.5 break-words text-[21px] font-semibold leading-tight text-primary">{title}</h1>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5" aria-label={copy.sessionIdLabel}>
        <Badge className="font-mono">
          <span className="sr-only">{copy.sessionIdLabel} </span>
          <span title={sessionId}>{sessionId.slice(0, 8)}</span>
        </Badge>
        <Badge>
          <span className="text-secondary">{copy.modelLabel}</span>
          <span className="text-primary">{model || copy.modelUnrecorded}</span>
        </Badge>
        {role ? (
          <Badge tone="info">
            <span>{copy.roleLabel}</span>
            <span>{role}</span>
          </Badge>
        ) : null}
        {provider ? (
          <Badge>
            <span className="text-secondary">{copy.providerLabel}</span>
            <span className="text-primary">{provider}</span>
          </Badge>
        ) : null}
      </div>
    </header>
  );
}
