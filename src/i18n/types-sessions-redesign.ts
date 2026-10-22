/**
 * Copy for the redesigned sessions list, session detail, team and team-run
 * pages (redesign card 5/6). Kept in its own file and wired through
 * types-tail.ts so parallel redesign cards never edit the same dictionary
 * region.
 */
export interface SessionsRedesignTranslationDictionarySections {
  sessionsRedesign: {
    /** Sessions list page header. */
    sessionsTitle: string;
    sessionsDescription: string;
    newSession: string;
    /** Team page header. */
    teamTitle: string;
    teamDescription: string;
    configureSpecialists: string;
    coordinatorLabel: string;
    teamMembersLabel: string;
    openTeamRun: string;
    teamRunsTitle: string;
    /** Search. */
    searchSessions: string;
    searchSessionsPlaceholder: string;
    searchTeamRuns: string;
    /** Filter yields nothing (different from "no sessions yet"). */
    filterEmptyTitle: string;
    filterEmptyDescription: string;
    /** Nothing recorded yet. */
    emptyTitle: string;
    emptyDescription: string;
    teamRunsEmptyTitle: string;
    teamRunsEmptyDescription: string;
    /** Read failed. */
    loadErrorTitle: string;
    loadErrorMessage: string;
    reload: string;
    staleListNote: string;
    loadingSessions: string;
    /** Rows. */
    sessionListLabel: string;
    sessionIdLabel: string;
    openSessionAction: string;
    renameAction: string;
    deleteAction: string;
    deleting: string;
    saving: string;
    deleteFailed: string;
    renameFailed: string;
    moreActions: string;
    childSessions: string;
    /** Session detail header. */
    sessionDetailEyebrow: string;
    teamSessionEyebrow: string;
    modelLabel: string;
    roleLabel: string;
    providerLabel: string;
    modelUnrecorded: string;
    contextPanelTitle: string;
    showContext: string;
    hideContext: string;
    backToSessions: string;
    backToTeam: string;
  };
}
