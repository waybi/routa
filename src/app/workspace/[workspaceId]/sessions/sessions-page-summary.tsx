"use client";

/**
 * Sessions page summary restored from the pre-redesign page (e4e5c162
 * sessions-page-client.tsx L84, L150-160, L177-186): the "active N" and
 * "latest recovery point" pills under the page header, and the "recent
 * session" button above the composer that opens the newest session. All
 * derived from the already-loaded /api/sessions list (acpStatus,
 * createdAt); design-spec §12 keeps them directly visible.
 */

import { useTranslation } from "@/i18n";

import type { SessionInfo } from "../types";
import { formatRelativeTime } from "../ui-components";

/** Sessions whose ACP connection is live (connecting or ready). */
export function countActiveSessions(sessions: ReadonlyArray<Pick<SessionInfo, "acpStatus">>): number {
  return sessions.filter((session) => session.acpStatus === "connecting" || session.acpStatus === "ready").length;
}

/** Newest session by createdAt, or null for an empty list. */
export function pickLatestSession<T extends Pick<SessionInfo, "createdAt">>(sessions: ReadonlyArray<T>): T | null {
  let latest: T | null = null;
  for (const session of sessions) {
    if (!latest || new Date(session.createdAt).getTime() > new Date(latest.createdAt).getTime()) {
      latest = session;
    }
  }
  return latest;
}

/** Display name: name, else "provider · role", else provider, else the fallback. */
export function sessionDisplayLabel(
  session: Pick<SessionInfo, "sessionId" | "name" | "provider" | "role">,
  fallback: string,
): string {
  if (session.name) return session.name;
  if (session.provider && session.role) return `${session.provider} · ${session.role.toLowerCase()}`;
  if (session.provider) return session.provider;
  return fallback.replace("{id}", session.sessionId.slice(0, 8));
}

const PILL_CLASS = "inline-flex items-center gap-1.5 rounded-md border border-default bg-subtle px-2 py-1 text-[11px] text-secondary";

export function SessionsSummaryPills({ sessions }: { sessions: ReadonlyArray<SessionInfo> }) {
  const { t } = useTranslation();
  const latest = pickLatestSession(sessions);
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="sessions-summary-pills">
      <span className={PILL_CLASS} data-testid="sessions-active-count">
        {t.workspace.active}
        <span className="font-semibold text-primary" data-testid="sessions-active-count-value">{countActiveSessions(sessions)}</span>
      </span>
      <span className={PILL_CLASS} data-testid="sessions-latest-recovery">
        {t.workspace.latestRecoveryPoint}
        <span className="font-semibold text-primary" data-testid="sessions-latest-recovery-value">
          {latest ? formatRelativeTime(latest.createdAt) : t.workspace.noRecentSession}
        </span>
      </span>
    </div>
  );
}

export function SessionsRecentButton({
  sessions,
  onOpen,
}: {
  sessions: ReadonlyArray<SessionInfo>;
  onOpen: (sessionId: string) => void;
}) {
  const { t } = useTranslation();
  const latest = pickLatestSession(sessions);
  if (!latest) return null;
  return (
    <button
      type="button"
      onClick={() => onOpen(latest.sessionId)}
      data-testid="sessions-recent-button"
      className="max-w-full shrink-0 truncate rounded-md border border-default bg-subtle px-2.5 py-1 text-[11px] font-medium text-secondary transition-colors duration-150 hover:bg-hover hover:text-primary focus-visible:outline-2 focus-visible:outline-accent motion-reduce:transition-none"
    >
      {sessionDisplayLabel(latest, t.homeRedesign.sessionFallback)}
    </button>
  );
}
