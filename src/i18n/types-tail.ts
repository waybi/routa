export interface TailTranslationDictionarySections {
  messageBubble: {
    thinking: string;
    input: string;
    task: string;
    plan: string;
    requestPermissions: string;
    permissionReason: string;
    permissionCommand: string;
    permissionSuggestedAccess: string;
    permissionTechnicalDetails: string;
    permissionAllow: string;
    permissionDeny: string;
    permissionApproved: string;
    permissionDenied: string;
    permissionScopeTurn: string;
    permissionScopeSession: string;
    permissionScopeHint: string;
    submit: string;
    priority: string;
    tokens: string;
    pleaseAnswer: string;
    failedToSubmit: string;
    parent: string;
    siblingSessions: string;
    childSessions: string;
    status: {
      done: string;
      failed: string;
      running: string;
      pending: string;
    };
  };

  // Tool Call Content
  toolCallContent: {
    jsonArray: string;
    items: string;
    jsonObject: string;
    keys: string;
    outputCodeSections: string;
    outputRendered: string;
    searchResults: string;
    fileContent: string;
    output: string;
    outputJson: string;
    codeTab: string;
    treeTab: string;
    rawTab: string;
    matches: string;
    chars: string;
  };

  // MCP Tools page
  mcpTools: {
    title: string;
    refresh: string;
    loading: string;
    essential: string;
    toolCount: string;
    noToolSelected: string;
    argumentsLabel: string;
    runTool: string;
    back: string;
    toolResult: string;
    inputSchema: string;
    categoryTask: string;
    categoryAgent: string;
    categoryNote: string;
    categoryWorkspace: string;
    categoryGit: string;
    loadFailed: string;
    loadFailedPrefix: string;
    toggleModeFailed: string;
    executionFailed: string;
    invalidJson: string;
  };

  // RepoSlide panel
  repoSlide: {
    title: string;
    statusReady: string;
    statusPathDetected: string;
    statusWaitingPath: string;
    statusDrafting: string;
    statusStarted: string;
    description: string;
    backToRepoSlide: string;
    refresh: string;
    loadingTranscript: string;
    loadFailed: string;
    latestOutput: string;
    noSummary: string;
    deckPath: string;
    copied: string;
    copyPath: string;
    downloadPptx: string;
    notDownloadable: string;
    noPathDetected: string;
  };

  // Debug pages
  debug: {
    acpReplayTitle: string;
    sessionId: string;
    lastEventId: string;
    reconnect: string;
    status: string;
    error: string;
    loadHistoryFailed: string;
    parseSseFailed: string;
    eventSourceDisconnected: string;
    historySnapshot: string;
    replayEvents: string;
    officeWasmPocTitle: string;
    officeWasmPocDescription: string;
    officeWasmPocSelectFile: string;
    officeWasmPocReader: string;
    officeWasmPocReaderWalnut: string;
    officeWasmPocReaderGenerated: string;
    officeWasmPocStatus: string;
    officeWasmPocFile: string;
    officeWasmPocArtifactType: string;
    officeWasmPocNoResult: string;
    officeWasmPocTopFields: string;
    officeWasmPocParsedOutput: string;
    unsupportedOfficeFormat: string;
    officeWasmPocBytes: string;
    officeWasmPocStatusIdle: string;
    officeWasmPocStatusInitializing: string;
    officeWasmPocStatusParsing: string;
    officeWasmPocStatusReady: string;
    officeWasmPocStatusError: string;
    officeWasmPocVisualPreview: string;
    officeWasmPocDebugDetails: string;
    officeWasmPocGeneratedSummary: string;
    officeWasmPocRawJson: string;
    officeWasmPocSheet: string;
    officeWasmPocSlide: string;
    officeWasmPocPlaySlideshow: string;
    officeWasmPocPreviousSlide: string;
    officeWasmPocNextSlide: string;
    officeWasmPocCloseSlideshow: string;
    officeWasmPocSpeakerNotes: string;
    officeWasmPocShowSpeakerNotes: string;
    officeWasmPocHideSpeakerNotes: string;
    officeWasmPocNoSheets: string;
    officeWasmPocNoSlides: string;
    officeWasmPocNoDocumentBlocks: string;
    officeWasmPocShowingFirstRows: string;
    officeWasmPocShapes: string;
    officeWasmPocTextRuns: string;
  };

  // UI components
  ui: {
    openInNewTab: string;
    closeEsc: string;
    loadingTeamRun: string;
    sessionsHeader: string;
    sessionsCount: string;
    loadingSessions: string;
    noSessionsFound: string;
    startConversation: string;
    noSessionSelected: string;
    selectSessionView: string;
    loading: string;
    home: string;
    sessions: string;
    runSessions: string;
    runSessionsDesc: string;
    openRawSession: string;
    noTranscriptContent: string;
  };

  // Team page
  teamPage: {
    team: string;
    runTitle: string;
    followLead: string;
    sessionLabel: string;
    live: string;
    reconnecting: string;
    refresh: string;
    openRawSession: string;
    customSpecialists: string;
    toolModeFull: string;
    toolModeEssential: string;
    mcpTools: string;
    traces: string;
    crafters: string;
    concurrency: string;
    installAgents: string;
    agentModeToast: string;
    objectiveSet: string;
    user: string;
    agentLead: string;
    leadCreatedPlan: string;
    dispatchFailed: string;
    taskAssigned: string;
    createdTeammate: string;
    openedSession: string;
    teammate: string;
    runtimeError: string;
    reportBack: string;
    member: string;
    createdWaiting: string;
  };

  // Settings pages (extended)
  settingsExtended: {
    schedulesTitle: string;
    schedulesDesc: string;
    schedulesBadge: string;
    schedulesPageTitle: string;
    workflowsTitle: string;
    workflowsDesc: string;
    workflowsBadge: string;
    mcpTitle: string;
    mcpDesc: string;
    mcpBadge: string;
    triggerLabel: string;
    triggerValue: string;
    runtimeLabel: string;
    runtimeValue: string;
    focusLabel: string;
    focusValue: string;
    outputLabel: string;
    outputValue: string;
    transportLabel: string;
    transportValue: string;
    scopeLabel: string;
    scopeValue: string;
    tickEndpoint: string;
    vercelCron: string;
    specialistsDesc: string;
    specialistsBadge: string;
    specialistsPurposeLabel: string;
    specialistsPurposeValue: string;
    specialistsBindingLabel: string;
    specialistsBindingValue: string;
  };

  // Chat Panel
  chat: {
    viewToggle: {
      chat: string;
      trace: string;
    };
    authRequiredTitle: string;
    typeMessage: string;
    typeCreateSession: string;
    connectFirst: string;
    availableAuthMethods: string;
    working: string;
    sessionConfig: {
      model: string;
      reasoningEffort: string;
      defaultEffort: string;
      unknownEffort: string;
      unknownModel: string;
      resumeToSwitch: string;
      /** Composer picker text when no model is chosen (session/new uses the default). */
      defaultModel: string;
    };
  };

  // GitHub Webhook Panel
  webhook: {
    tabs: {
      configurations: string;
      triggerLogs: string;
    };
    addTrigger: string;
    localPolling: string;
    running: string;
    stopped: string;
    disablePolling: string;
    enablePolling: string;
    manuallyCheckNow: string;
    checkNow: string;
    lastChecked: string;
    localPollingHint: string;
    emptyTitle: string;
    emptyDescription: string;
    addFirstTrigger: string;
    editWebhookTrigger: string;
    newWebhookTrigger: string;
    nameLabel: string;
    namePlaceholder: string;
    githubRepository: string;
    repoFormatHint: string;
    githubToken: string;
    tokenKeepHint: string;
    tokenRequired: string;
    tokenPlaceholder: string;
    tokenEditPlaceholder: string;
    webhookSecret: string;
    secretHint: string;
    eventsToSubscribe: string;
    labelFilter: string;
    labelFilterHint: string;
    labelFilterPlaceholder: string;
    triggerAgent: string;
    selectAgent: string;
    promptTemplate: string;
    promptTemplateHint: string;
    promptTemplatePlaceholder: string;
    enabled: string;
    registerOnGithub: string;
    edit: string;
    delete: string;
    recentEvents: string;
    refresh: string;
    noEventsYet: string;
    noEventsHint: string;
    taskLabel: string;
    events: {
      issues: string;
      issuesDesc: string;
      pullRequests: string;
      pullRequestsDesc: string;
      prReviews: string;
      prReviewsDesc: string;
      prReviewComments: string;
      prReviewCommentsDesc: string;
      checkRuns: string;
      checkRunsDesc: string;
      checkSuites: string;
      checkSuitesDesc: string;
      workflowRuns: string;
      workflowRunsDesc: string;
      workflowJobs: string;
      workflowJobsDesc: string;
      push: string;
      pushDesc: string;
      create: string;
      createDesc: string;
      delete: string;
      deleteDesc: string;
      issueComments: string;
      issueCommentsDesc: string;
    };
    configCreated: string;
    configUpdated: string;
    configDeleted: string;
    requiredFieldsError: string;
    deleteConfirm: string;
    registerPrompt: string;
    registerSuccess: string;
    pollingEnabled: string;
    pollingDisabled: string;
    checkComplete: string;
    togglePollingFailed: string;
    manualCheckFailed: string;
    updateIntervalFailed: string;
    registerFailed: string;
    loading: string;
    disable: string;
    enable: string;
  };

  // A2A Page
  a2aPage: {
    sessionIdRequired: string;
    describeWhatYouNeed: string;
  };

  // Git Log Panel
  gitLog: {
    title: string;
    refs: string;
    head: string;
    local: string;
    remote: string;
    tags: string;
    commits: string;
    message: string;
    author: string;
    date: string;
    hash: string;
    changedFiles: string;
    noCommits: string;
    selectCommit: string;
    loadingCommits: string;
    loadingMore: string;
    filterPlaceholder: string;
    clearFilters: string;
    showRefs: string;
    hideRefs: string;
    parents: string;
    files: string;
  };

  // Transient feedback (toasts) and task lifecycle notifications
  feedback: {
    // Generic
    retry: string;
    // Kanban card creation
    cardCreating: string;
    cardCreated: string;
    cardCreateFailed: string;
    // Kanban card deletion
    cardDeleting: string;
    cardDeleted: string;
    cardDeleteFailed: string;
    // Kanban agent session
    agentSessionCreating: string;
    agentSessionCreateFailed: string;
    agentPromptFailed: string;
    agentPromptFailedHint: string;
    // Board settings / provider persistence
    boardProviderPersistFailed: string;
    // Worktree cleanup confirm (replaces window.confirm)
    worktreeCleanupTitle: string;
    worktreeCleanupBody: string;
    worktreeCleanupConfirm: string;
    worktreeCleanupSkip: string;
    // Task lifecycle notifications
    taskCompleted: string;
    taskFailed: string;
    taskNeedsReview: string;
    taskBlocked: string;
    taskRejected: string;
    openCard: string;
    // Browser notification permission
    notificationsEnabled: string;
  };
  /** One-line run activity on the kanban card face (working / may be stuck / failed). */
  kanbanCardActivity: {
    /** Run is alive but has been silent past the stall threshold. */
    stalled: string;
    justNow: string;
    secondsAgo: string;
    minutesAgo: string;
    quietFor: string;
    runningTool: string;
    turnDone: string;
    waitingFirst: string;
    error: string;
  };
  kanbanModelSelection: {
    model: string;
    reasoningEffort: string;
    /** First dropdown item: leave the field unset so the default applies. */
    followDefault: string;
    cardModelOverride: string;
    cardReasoningEffortOverride: string;
    /** Single lane-step field combining model and effort. */
    modelAndEffort: string;
    /** Single card-override field combining model and effort. */
    cardModelEffortOverride: string;
    /** Effort segment that leaves the effort to the agent default. */
    defaultEffort: string;
    /** aria-label / title of the model + effort picker button. */
    pickerAriaLabel: string;
    /** Shown in the picker panel when the provider lists no models. */
    noModels: string;
  };
}
