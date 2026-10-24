"use client";

import type { ReactNode } from "react";

import { Badge } from "@/client/components/ui/badge";
import { useTranslation } from "@/i18n";

export interface SessionDetailHeaderProps {
  /** Small label before the title, e.g. "施工会话". */
  eyebrow: ReactNode;
  /** Plain text: also used as the hover title when the heading is truncated. */
  title: string;
  sessionId: string;
  model?: string | null;
  role?: string | null;
  provider?: string | null;
  actions?: ReactNode;
  testId?: string;
}

/**
 * Header for the session detail page (prototype `sessionPage()`): page label,
 * session title, then ID / model / role / provider badges and the actions.
 * On wide screens (xl) it is a single row: the title truncates to one line
 * and shows the full text on hover (2026-10-24 老板要求压缩顶部高度，覆盖
 * design-spec §3 的「标题换行不截断」). Narrow screens may wrap.
 * The model badge says "not recorded" rather than inventing one.
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
    <header
      data-testid={testId}
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-default bg-canvas px-4 py-1.5 md:px-[22px] xl:flex-nowrap xl:px-7"
    >
      <div className="flex min-w-0 flex-1 basis-full items-baseline gap-2 xl:basis-0" data-testid="session-detail-title-group">
        <span className="shrink-0 text-xs text-secondary">{eyebrow}</span>
        <h1 className="m-0 min-w-0 truncate text-[15px] font-semibold leading-tight text-primary" title={title}>{title}</h1>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 xl:flex-nowrap" aria-label={copy.sessionIdLabel} data-testid="session-detail-badges">
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
      {actions ? (
        <div className="ml-auto flex shrink-0 items-center gap-2" data-testid="session-detail-actions">{actions}</div>
      ) : null}
    </header>
  );
}
