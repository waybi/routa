/**
 * Copy for the session detail redesign (redesign card 7): the three main
 * tabs (chat / events / evidence), the right-hand context sidebar, relative
 * times, and the residual English strings cleared from sessions, settings
 * and the task editor. Wired through types-tail.ts so parallel redesign
 * cards never edit the same dictionary region.
 */
export interface SessionDetailRedesignTranslationDictionarySections {
  sessionDetailRedesign: {
    tabs: {
      label: string;
      chat: string;
      events: string;
      evidence: string;
    };
    events: {
      types: {
        user_message: string;
        agent_message: string;
        agent_thought: string;
        tool_call: string;
        tool_result: string;
        session_start: string;
        session_end: string;
      };
      /** "{count}" = number of files not listed. */
      moreFiles: string;
      /** "{count}" = the request limit. */
      truncated: string;
      loading: string;
      emptyTitle: string;
      emptyDescription: string;
      errorTitle: string;
      retry: string;
      openInTraces: string;
      listLabel: string;
    };
    evidence: {
      linkedCardTitle: string;
      cardIdLabel: string;
      columnLabel: string;
      openCardChanges: string;
      artifactsTitle: string;
      changedFilesTitle: string;
      noLinkedCard: string;
      noChangedFiles: string;
      emptyTitle: string;
      emptyDescription: string;
      errorTitle: string;
      retry: string;
      loading: string;
    };
    context: {
      sidebarLabel: string;
      title: string;
      workspace: string;
      provider: string;
      branch: string;
      status: string;
      statusRunning: string;
      statusIdle: string;
      statusConnecting: string;
      statusError: string;
      statusUnknown: string;
      linksTitle: string;
      traces: string;
      acpReplay: string;
      closeDrawer: string;
    };
    relativeTime: {
      justNow: string;
      /** "{count}" = whole minutes. */
      minutesAgo: string;
      hoursAgo: string;
      daysAgo: string;
      weeksAgo: string;
    };
    composer: {
      placeholder: string;
      switchToBuiltInRole: string;
      switchSpecialist: string;
      multiAgentHint: string;
      crafterHint: string;
      customSpecialistHint: string;
      setupPlaceholder: string;
      setupTitle: string;
      setupDescription: string;
    };
    sidebar: {
      quickAccess: string;
      openTasks: string;
      specPreview: string;
      taskSnapshot: string;
      parent: string;
    };
    taskEditor: {
      deleteSpec: string;
      noContent: string;
      objective: string;
      scope: string;
      inputs: string;
      outputs: string;
      definitionOfDone: string;
      deleteTask: string;
      statusPending: string;
      statusInProgress: string;
      statusCompleted: string;
      statusFailed: string;
      contentPlaceholder: string;
    };
    settings: {
      providersDescription: string;
      providerCredentials: string;
      modelBlankHintBefore: string;
      modelsTabLink: string;
      modelBlankHintAfter: string;
      customProvidersTitle: string;
      customProvidersDescription: string;
      noCustomProviders: string;
      providerCatalogTitle: string;
      noProviders: string;
      webhookUrlHint: string;
      manageWebhookTriggers: string;
      dockerMountHint: string;
      explorer: string;
      inspector: string;
      duplicate: string;
      specialistPromptPlaceholder: string;
      source: string;
      category: string;
      writable: string;
    };
    harness: {
      sources: string;
      loadingFiles: string;
      noFiles: string;
      noCommandBlocks: string;
      selectFile: string;
      resizeBottomPanel: string;
      openFullView: string;
      resizeExplorer: string;
    };
  };
}
