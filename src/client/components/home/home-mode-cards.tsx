"use client";

/**
 * Execution-mode block restored from the pre-redesign home page
 * (e4e5c162 src/app/page.tsx L366-371, L391-460): the "which execution
 * mode" hero text plus one card per mode (sessions / kanban / team), each a
 * link with its description and technical detail. Always visible; the
 * redesign must not drop or hide it (design-spec §12).
 */

import Link from "next/link";
import { useTranslation } from "@/i18n";

type ModeKey = "sessions" | "kanban" | "team";

export function HomeModeCards({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation();
  const home = t.home;
  const id = encodeURIComponent(workspaceId);
  const modes: ReadonlyArray<{ key: ModeKey; href: string; title: string; description: string; technical: string }> = [
    {
      key: "sessions",
      href: `/workspace/${id}/sessions`,
      title: home.sessionsSurfaceTitle,
      description: home.modeSessionDescription,
      technical: home.modeSessionTechnical,
    },
    {
      key: "kanban",
      href: `/workspace/${id}/kanban`,
      title: home.kanbanSurfaceTitle,
      description: home.modeKanbanDescription,
      technical: home.modeKanbanTechnical,
    },
    {
      key: "team",
      href: `/workspace/${id}/team`,
      title: home.teamSurfaceTitle,
      description: home.modeTeamDescription,
      technical: home.modeTeamTechnical,
    },
  ];

  return (
    <section aria-labelledby="home-mode-heading" data-testid="home-mode-cards">
      <h2 id="home-mode-heading" className="m-0 text-[15px] font-semibold text-primary" data-testid="home-mode-title">
        {home.whatToAdvance}
      </h2>
      <p className="m-0 mt-1 max-w-3xl text-xs leading-relaxed text-secondary" data-testid="home-mode-hint">
        {home.homePrimaryHint}
      </p>
      <div className="mt-3 grid grid-cols-1 gap-4 min-[801px]:grid-cols-3">
        {modes.map((mode) => (
          <Link
            key={mode.key}
            href={mode.href}
            data-testid={`home-mode-card-${mode.key}`}
            className="flex h-full min-w-0 flex-col rounded-lg border border-default bg-surface p-4 transition-colors duration-150 hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent motion-reduce:transition-none"
          >
            <span className="text-[11px] text-secondary">{home.surfaceLabel}</span>
            <span className="mt-1 text-sm font-semibold text-primary">{mode.title}</span>
            <span className="mt-2 text-[13px] leading-relaxed text-secondary">{mode.description}</span>
            <span className="mt-3 border-t border-default pt-2">
              <span className="block text-[11px] font-medium text-secondary">{home.modeTechnicalLabel}</span>
              <span className="mt-1 block text-xs leading-relaxed text-secondary">{mode.technical}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
