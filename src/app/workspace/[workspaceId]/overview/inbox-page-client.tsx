"use client";

/**
 * "Needs you" page (design-spec §4): every card that needs the owner, sorted
 * clear failure → missing evidence → waiting for you. Read-only: it only
 * issues the GETs of useWorkspaces / useKanbanOverviewData plus their SSE
 * stream. "Hide locally" writes the same localStorage key as the board's
 * "Got it", so hiding in either place hides in both.
 */

import { useCallback, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslation } from "@/i18n";
import { DesktopAppShell } from "@/client/components/desktop-app-shell";
import { InboxBadgeDataProvider } from "@/client/components/shell/inbox-badge-data-context";
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import { useWorkspaces } from "@/client/hooks/use-workspaces";
import { Badge } from "@/client/components/ui/badge";
import { buttonClassName } from "@/client/components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@/client/components/ui/states";
import { resolveRouteWorkspaceId, useMinuteClock } from "@/client/components/home/relative-time";
import { useKanbanOverviewData, type OverviewWorkspaceData } from "../kanban/use-kanban-overview-data";
import {
  dismissAttentionItem,
  readAttentionDismissals,
  restoreAttentionItem,
} from "../kanban/use-kanban-attention-dismissals";
import { buildInboxRows, type InboxRow } from "./inbox-rules";
import { InboxRowItem } from "./inbox-row";
import { useInboxScope, type InboxScope } from "./inbox-view-mode";

const LOADING: OverviewWorkspaceData = { status: "loading", tasks: [], boards: [] };

function ScopeToggle({ scope, onChange }: { scope: InboxScope; onChange: (scope: InboxScope) => void }) {
  const { t } = useTranslation();
  const button = (value: InboxScope, label: string) => (
    <button
      type="button"
      aria-pressed={scope === value}
      onClick={() => onChange(value)}
      data-testid={`inbox-scope-${value}`}
      className={`h-7 rounded px-2.5 text-xs font-medium transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-accent ${scope === value
        ? "bg-accent text-on-accent"
        : "text-secondary hover:bg-hover hover:text-primary"}`}
    >
      {label}
    </button>
  );
  return (
    <div role="group" aria-label={t.inboxPage.scopeLabel} className="inline-flex gap-0.5 rounded-md border border-default bg-surface p-0.5">
      {button("workspace", t.inboxPage.scopeWorkspace)}
      {button("all", t.inboxPage.scopeAll)}
    </div>
  );
}

function CountCell({ label, value, loading, testId }: { label: string; value: number; loading: boolean; testId: string }) {
  return (
    <div className="min-w-0 border-b border-default pb-3" data-testid={testId}>
      <div className="text-xs text-secondary">{label}</div>
      {loading
        ? <div aria-hidden="true" className="mt-2 h-7 w-10 animate-pulse rounded bg-subtle motion-reduce:animate-none" />
        : <div className="mt-1 text-[26px] font-semibold leading-tight text-primary" data-testid={`${testId}-value`}>{value}</div>}
    </div>
  );
}

export function InboxPageClient({ now: fixedNow }: { now?: number } = {}) {
  const params = useParams();
  const router = useRouter();
  const { t } = useTranslation();
  const page = t.inboxPage;
  const workspaceId = resolveRouteWorkspaceId(params?.workspaceId as string | undefined);
  const workspacesHook = useWorkspaces();
  const { workspaces } = workspacesHook;
  const { data, retry } = useKanbanOverviewData(workspaces);
  const { scope, setScope } = useInboxScope();
  const now = useMinuteClock(fixedNow);
  // Bumped after a local hide / show so the rows re-read localStorage.
  const [, setDismissVersion] = useState(0);

  const activeWorkspace = workspaces.find((workspace) => workspace.id === workspaceId) ?? null;
  const scoped = scope === "all" ? workspaces : workspaces.filter((workspace) => workspace.id === workspaceId);
  const statusOf = (id: string) => (data[id] ?? LOADING).status;
  const loading = now === 0 || workspacesHook.loading || scoped.some((workspace) => statusOf(workspace.id) === "loading" && !data[workspace.id]?.tasks.length);
  const failed = scoped.filter((workspace) => statusOf(workspace.id) === "error");

  // Read dismissals on every render: the board strip may have changed them.
  const rows = buildInboxRows(scoped, data, now, readAttentionDismissals);
  const allRows = scope === "all" ? rows : buildInboxRows(workspaces, data, now, readAttentionDismissals);
  const counts = [1, 2, 3].map((severity) => rows.active.filter((row) => row.severity === severity).length);

  const toggleDismiss = useCallback((row: InboxRow) => {
    const isDismissed = readAttentionDismissals(row.boardId).includes(row.dismissKey);
    if (isDismissed) restoreAttentionItem(row.boardId, row.dismissKey);
    else dismissAttentionItem(row.boardId, row.dismissKey);
    setDismissVersion((version) => version + 1);
  }, []);

  const renderRows = (list: InboxRow[], dismissed: boolean) => {
    if (scope !== "all") {
      return list.map((row) => (
        <InboxRowItem key={row.key} row={row} now={now} dismissed={dismissed} showWorkspace={false} onToggleDismiss={toggleDismiss} />
      ));
    }
    return scoped
      .map((workspace) => ({ workspace, items: list.filter((row) => row.workspaceId === workspace.id) }))
      .filter((group) => group.items.length > 0)
      .map(({ workspace, items }) => (
        <section key={workspace.id} data-testid="inbox-group" data-workspace-id={workspace.id} aria-label={workspace.title}>
          <h3 className="mt-4 flex flex-wrap items-center gap-2 text-[13px] font-semibold text-primary">
            {workspace.title}
            <span className="font-normal text-secondary">{page.groupCount.replace("{count}", String(items.length))}</span>
            {statusOf(workspace.id) === "error" && <Badge tone="attention">{page.stale}</Badge>}
          </h3>
          {items.map((row) => (
            <InboxRowItem key={row.key} row={row} now={now} dismissed={dismissed} showWorkspace={false} onToggleDismiss={toggleDismiss} />
          ))}
        </section>
      ));
  };

  let listBody: React.ReactNode;
  if (loading) {
    listBody = <Skeleton lines={4} label={page.loading} className="py-4" />;
  } else if (rows.active.length > 0) {
    listBody = renderRows(rows.active, false);
  } else if (failed.length > 0) {
    listBody = null;
  } else if (rows.dismissed.length > 0) {
    listBody = <EmptyState title={page.allDismissedTitle} description={page.allDismissedHint} className="my-4" />;
  } else if (scope !== "all" && allRows.active.length > 0) {
    listBody = (
      <EmptyState
        title={page.emptyScopeTitle}
        description={page.emptyScopeHint}
        action={<button type="button" className={buttonClassName("secondary", "sm")} onClick={() => setScope("all")}>{page.scopeAll}</button>}
        className="my-4"
      />
    );
  } else {
    listBody = (
      <EmptyState
        title={page.emptyTitle}
        description={page.emptyHint}
        action={<Link href={`/workspace/${encodeURIComponent(workspaceId)}/kanban`} className={buttonClassName("secondary", "sm")}>{page.viewBoard}</Link>}
        className="my-4"
      />
    );
  }

  return (
    // The nav badge reuses this page's data instead of fetching it again.
    <InboxBadgeDataProvider workspaces={workspaces} workspacesLoading={workspacesHook.loading} data={data}>
    <DesktopAppShell
      workspaceId={workspaceId}
      workspaceTitle={activeWorkspace?.title}
      workspaceSwitcher={(
        <WorkspaceSwitcher
          workspaces={workspaces}
          activeWorkspaceId={workspaceId}
          activeWorkspaceTitle={activeWorkspace?.title}
          onSelect={(id) => router.push(`/workspace/${encodeURIComponent(id)}/overview`)}
          onCreate={async (title) => {
            const created = await workspacesHook.createWorkspace(title);
            if (created) router.push(`/workspace/${encodeURIComponent(created.id)}/overview`);
          }}
          loading={workspacesHook.loading}
          compact
          desktop
        />
      )}
    >
      <div className="h-full overflow-y-auto bg-canvas" data-testid="inbox-page">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-4 min-[801px]:p-[22px] min-[1101px]:p-7">
          <header className="flex min-h-12 flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="m-0 text-[21px] font-[650] leading-tight text-primary">{page.title}</h1>
              <p className="m-0 mt-1 text-xs text-secondary">{page.subtitle}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ScopeToggle scope={scope} onChange={setScope} />
              <Link href={`/workspace/${encodeURIComponent(workspaceId)}/kanban`} className={buttonClassName("secondary", "md")} data-testid="inbox-view-board">
                {page.viewBoard}
              </Link>
            </div>
          </header>

          <section aria-label={page.countsLabel} className="grid grid-cols-1 gap-4 min-[601px]:grid-cols-3" data-testid="inbox-counts">
            <CountCell label={page.countP1} value={counts[0]} loading={loading} testId="inbox-count-p1" />
            <CountCell label={page.countP2} value={counts[1]} loading={loading} testId="inbox-count-p2" />
            <CountCell label={page.countP3} value={counts[2]} loading={loading} testId="inbox-count-p3" />
          </section>

          {failed.map((workspace) => (
            <ErrorState
              key={workspace.id}
              title={page.loadFailed.replace("{workspace}", workspace.title)}
              message={page.loadFailedHint}
              onRetry={() => retry(workspace.id)}
              retryLabel={page.reload}
            />
          ))}

          <section className="rounded-lg border border-default bg-surface px-4 pb-2 pt-4 min-[801px]:px-5" data-testid="inbox-list">
            <h2 className="m-0 flex flex-wrap items-center gap-2 text-[15px] font-semibold text-primary">
              {page.listTitle}
              {failed.length > 0 && <Badge tone="attention">{page.stale}</Badge>}
            </h2>
            {listBody}
          </section>

          {!loading && rows.dismissed.length > 0 && (
            <details className="rounded-lg border border-default bg-surface px-4 py-3 min-[801px]:px-5" data-testid="inbox-dismissed">
              <summary className="cursor-pointer text-[13px] font-medium text-secondary focus-visible:outline-2 focus-visible:outline-accent">
                {page.dismissedSummary.replace("{count}", String(rows.dismissed.length))}
              </summary>
              {renderRows(rows.dismissed, true)}
            </details>
          )}
        </div>
      </div>
    </DesktopAppShell>
    </InboxBadgeDataProvider>
  );
}
