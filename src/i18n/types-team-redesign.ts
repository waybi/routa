/**
 * Copy for the redesigned team page (coordinator cards + run records table)
 * and team-session page (three-tab session template), redesign card 8.
 * Wired only through types-extended.ts so it never touches the tail layer
 * used by the parallel sessions redesign card.
 *
 * Templates use `{actor}`, `{target}`, `{role}` and `{count}` placeholders.
 */
export interface TeamRedesignTranslationDictionarySections {
  teamRedesign: {
    common: {
      notRecorded: string;
      reload: string;
      staleNote: string;
    };
    page: {
      launchRun: string;
      launchPanelTitle: string;
      launchPanelDescription: string;
      workspaceFallback: string;
      runsSearchLabel: string;
    };
    coordinators: {
      sectionLabel: string;
      cardTitle: string;
      openTeamSession: string;
      notLinked: string;
      linkedSessionLabel: string;
      displayLabel: string;
      createdLabel: string;
      emptyTitle: string;
      emptyDescription: string;
      loadErrorTitle: string;
      loading: string;
    };
    records: {
      tableTitle: string;
      colSession: string;
      colRepoBranch: string;
      colRole: string;
      colMembers: string;
      colStatus: string;
      colStartedAt: string;
      colActions: string;
      openRecord: string;
      coordinatorBadge: string;
      sortHint: string;
      scrollHint: string;
    };
    roster: {
      summary: string;
      loadError: string;
      manageLink: string;
      empty: string;
      noDescription: string;
      leadRole: string;
      defaultRole: string;
    };
    session: {
      eyebrow: string;
      unnamedRun: string;
      modelNotRecorded: string;
      tabsLabel: string;
      tabConversation: string;
      tabEvents: string;
      tabEvidence: string;
      contextTitle: string;
      workspace: string;
      provider: string;
      model: string;
      cwd: string;
      branch: string;
      status: string;
      createdAt: string;
      membersTitle: string;
      linksTitle: string;
      traces: string;
      acpReplay: string;
      loadErrorTitle: string;
      loadErrorMessage: string;
      loadingRun: string;
      eventsEmptyTitle: string;
      eventsEmptyDescription: string;
      openMemberSession: string;
      leadFallbackName: string;
      memberFallback: string;
      createdAgentWaiting: string;
    };
    events: {
      objectiveSet: string;
      leadCreatedPlan: string;
      taskAssigned: string;
      dispatchFailed: string;
      createdTeammate: string;
      openedSession: string;
      runtimeError: string;
      completionBlocker: string;
      completionRevision: string;
      completionReview: string;
      completionFindings: string;
      completionUiProposal: string;
      completionPhase: string;
      joinedAs: string;
      userActor: string;
      teammateFallback: string;
      teamMemberFallback: string;
    };
    lane: {
      update: string;
      reportBack: string;
      user: string;
      agent: string;
      runtime: string;
      tool: string;
    };
    status: {
      unknown: string;
      agent: { pending: string; active: string; completed: string; error: string; cancelled: string };
      acp: { connecting: string; ready: string; error: string };
      terminal: { completed: string; failed: string; timedOut: string };
      member: { idle: string; working: string; blocked: string; reviewing: string; done: string };
      task: { notStarted: string; inProgress: string; waitingReview: string; done: string; blocked: string };
      deliverable: { draft: string; review: string; approved: string };
      deliverableLabel: {
        deliverable: string;
        findings: string;
        testReport: string;
        uiProposal: string;
        patch: string;
        specDraft: string;
        workPackage: string;
        teamNote: string;
      };
      eventType: { plan: string; assign: string; revision: string; finding: string; complete: string; blocked: string };
    };
    /** Team page v2 (redesign card 14): header stats block and shortcut hints. */
    header: {
      statsLabel: string;
      launchShortcut: string;
      launchShortcutHint: string;
    };
    /** Always-visible launch box: "try" template chips. */
    launch: {
      templatesLabel: string;
      template1: string;
      template2: string;
      template3: string;
      template4: string;
    };
    /** Team formation: lead card, role groups, list view. */
    formation: {
      title: string;
      viewLabel: string;
      viewMap: string;
      viewList: string;
      groupRouta: string;
      groupCrafter: string;
      groupGate: string;
      groupDeveloper: string;
      groupOther: string;
      groupCount: string;
      details: string;
      instancesLabel: string;
      idle: string;
      working: string;
      mention: string;
      mentionAria: string;
      openMemberAria: string;
      /** Display names of the bundled team specialists, keyed by specialist id. */
      memberNames: Record<string, string>;
    };
    /** Member drawer. */
    drawer: {
      label: string;
      specialistId: string;
      role: string;
      modelTier: string;
      currentStatus: string;
      recentRuns: string;
      noRecentRuns: string;
      mentionDispatch: string;
      editInSettings: string;
      close: string;
    };
    /** Run records: status filter, list footer, empty state. */
    runs: {
      filterLabel: string;
      filterAll: string;
      filterActive: string;
      filterEnded: string;
      filterError: string;
      openArrow: string;
      footer: string;
      memberCount: string;
      clearFilters: string;
      emptyLead: string;
      step1Title: string;
      step1Body: string;
      step2Title: string;
      step2Body: string;
      step3Title: string;
      step3Body: string;
      writeFirstTask: string;
      searchShortcut: string;
      searchShortcutHint: string;
    };
  };
}
