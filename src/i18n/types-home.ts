/**
 * Copy for the redesigned home page (/) and the "Needs you" page
 * (/workspace/:workspaceId/overview). Kept in its own section, mounted at the
 * top of the dictionary chain, so the parallel redesign cards never edit the
 * same dictionary file. Attention kind names and "Got it" are reused from
 * `kanbanAttention`, not copied here.
 */
export interface HomeTranslationDictionarySections {
  homeRedesign: {
    title: string;
    subtitle: string;
    enterBoard: string;
    loading: string;
    /** "{count}" = active attention items across every workspace. */
    bannerTitle: string;
    /** "{title}" = full title of the most urgent card. */
    bannerTop: string;
    openInbox: string;
    workspacesSection: string;
    open: string;
    inProgress: string;
    needsYou: string;
    /** "{time}" = relative time of the newest authoritative event. */
    recentActivity: string;
    noActivity: string;
    stale: string;
    /** "{workspace}" = workspace title. */
    loadFailed: string;
    loadFailedHint: string;
    reload: string;
    latestResult: string;
    readReport: string;
    noResultTitle: string;
    noResultHint: string;
    createSection: string;
    createHint: string;
    newCard: string;
    newSession: string;
    /** "{name}" = session label. */
    continueSession: string;
    /** "{id}" = first 8 chars of the session id. */
    sessionFallback: string;
    readinessTitle: string;
    readinessModel: string;
    readinessCodebase: string;
    configure: string;
    addCodebase: string;
    justNow: string;
    /** "{count}" = minutes. */
    minutesAgo: string;
    /** "{count}" = hours. */
    hoursAgo: string;
    /** "{count}" = days. */
    daysAgo: string;
    timeUnknown: string;
  };
  inboxPage: {
    title: string;
    subtitle: string;
    viewBoard: string;
    scopeLabel: string;
    scopeWorkspace: string;
    scopeAll: string;
    countsLabel: string;
    countP1: string;
    countP2: string;
    countP3: string;
    listTitle: string;
    severityP1: string;
    severityP2: string;
    severityP3: string;
    labelReason: string;
    labelSource: string;
    labelTime: string;
    labelNext: string;
    labelWorkspace: string;
    reasonDoneFailed: string;
    /** "{error}" = lastSyncError, verbatim. */
    reasonBlockedError: string;
    reasonNoReport: string;
    /** "{count}" = commits ahead of base. */
    reasonUnmerged: string;
    reasonBlockedUnknown: string;
    /** "{column}" = lane name, "{status}" = runFailed / runTimedOut. */
    reasonInterrupted: string;
    /** "{status}" = runFailed / runTimedOut. */
    sourceDoneFailed: string;
    runFailed: string;
    runTimedOut: string;
    sourceBlockedError: string;
    sourceNoReport: string;
    /** "{count}" = commits ahead of base. */
    sourceUnmerged: string;
    sourceBlockedUnknown: string;
    /** Shown when an interrupted card has no lastSyncError. */
    sourceInterruptedNone: string;
    nextDoneFailed: string;
    nextBlockedError: string;
    nextNoReport: string;
    nextUnmerged: string;
    nextBlockedUnknown: string;
    nextInterrupted: string;
    openCard: string;
    dismiss: string;
    restore: string;
    /** "{count}" = dismissed rows. */
    dismissedSummary: string;
    emptyTitle: string;
    emptyHint: string;
    emptyScopeTitle: string;
    emptyScopeHint: string;
    allDismissedTitle: string;
    allDismissedHint: string;
    /** "{workspace}" = workspace title. */
    loadFailed: string;
    loadFailedHint: string;
    reload: string;
    stale: string;
    loading: string;
    /** "{count}" = rows in the group. */
    groupCount: string;
    rerun: string;
    /** Checkbox label; "{title}" = card title. */
    selectRow: string;
    /** "{count}" = active interrupted rows. */
    bulkInterrupted: string;
    selectAll: string;
    /** "{count}" = selected rows. */
    bulkRerun: string;
    /** "{count}" = selected rows. */
    bulkConfirm: string;
    bulkConfirmYes: string;
    bulkConfirmNo: string;
    rerunStarting: string;
    rerunStarted: string;
    rerunQueued: string;
    /** "{error}" = server error, verbatim. */
    rerunFailed: string;
    rerunSkipped: string;
    /** "{started}" / "{queued}" / "{skipped}" / "{failed}" = row counts. */
    bulkSummary: string;
  };
}
