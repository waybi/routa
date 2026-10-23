/**
 * Name written onto a newly launched team run (PATCH /api/sessions/:sid).
 *
 * This is a data marker, not UI copy: the sessions API recognises team runs
 * by the `team -` / `team run` name prefix (src/app/api/sessions/route.ts,
 * hasExplicitTeamRunMarker). Do not translate it or change the format, or
 * new runs disappear from the team page.
 */
export function buildTeamRunName(requirement: string): string {
  const normalized = requirement.replace(/\s+/g, " ").trim();
  if (!normalized) return "Team run";
  return normalized.length > 56 ? `Team - ${normalized.slice(0, 53)}...` : `Team - ${normalized}`;
}
