/**
 * Copy for redesign card 6/6: settings pages, the settings overview cards,
 * the re-shelled resource / developer pages, the sidebar resource and
 * developer groups, and the collapsed Done rail. Hung on the shell layer so
 * it never collides with the tail / extended dictionaries other cards edit.
 */
export interface RedesignSettingsTranslationDictionarySections {
  settingsRedesign: {
    overview: {
      title: string;
      description: string;
      configure: string;
      legacyTitle: string;
      legacyDescription: string;
      items: {
        agents: string;
        specialists: string;
        workflows: string;
        mcp: string;
        mcpTools: string;
        schedules: string;
        webhooks: string;
        fitness: string;
        fluency: string;
        harness: string;
      };
    };
    pages: {
      agents: { title: string; description: string };
      specialists: { title: string; description: string };
      workflows: { title: string; description: string };
      mcp: { title: string; description: string };
      schedules: { title: string; description: string };
      webhooks: { title: string; description: string };
      harness: { title: string; description: string };
      fluency: { title: string; description: string };
    };
    mcpPage: {
      tabsLabel: string;
      servers: string;
      tools: string;
      toolsTitle: string;
      scope: string;
    };
    states: {
      loadFailed: string;
      reload: string;
      saveFailed: string;
    };
    schedules: {
      emptyTitle: string;
      emptyDescription: string;
    };
    webhooks: {
      emptyTitle: string;
      emptyDescription: string;
      tokenDialogTitle: string;
      tokenDialogDescription: string;
      tokenLabel: string;
      tokenPlaceholder: string;
      confirm: string;
      cancel: string;
    };
    mcp: {
      emptyTitle: string;
      emptyDescription: string;
    };
  };
  pagesRedesign: {
    doneRail: {
      label: string;
      expand: string;
      unmerged: string;
    };
    sidebar: {
      resources: string;
      developer: string;
      featureExplorer: string;
      reposlide: string;
      canvas: string;
      traces: string;
      messages: string;
      a2a: string;
      agUi: string;
      acpReplay: string;
      officeLab: string;
    };
    headers: {
      messages: { title: string; description: string };
      a2a: { title: string; description: string };
      agUi: { title: string; description: string };
      canvas: { title: string; description: string };
      acpReplay: { title: string; description: string };
      officeLab: { title: string; description: string };
      spec: { title: string; description: string };
      reposlide: { title: string; description: string };
      traces: { title: string; description: string };
      featureExplorer: { title: string; description: string };
    };
    messagesPage: {
      tabTasks: string;
      tabLogs: string;
      tasksTitle: string;
      tasksEmpty: string;
      logsTitle: string;
      logsEmpty: string;
      type: string;
      created: string;
      completed: string;
      config: string;
      signature: string;
    };
    canvasPage: {
      loadFailedTitle: string;
      loadFailedDescription: string;
    };
  };
  kanbanModelTiers: {
    title: string;
    description: string;
    order: string;
    tiers: { fast: string; balanced: string; smart: string };
    /** First dropdown option; {model} = code tier default. */
    followCodeDefault: string;
    effective: string;
    sourceGlobal: string;
    sourceCode: string;
    /** Native hover text per tier row: which specialists use it. */
    tierTooltip: string;
    tierTooltipOthers: string;
    tierTooltipNone: string;
    noModels: string;
    saving: string;
    saved: string;
    saveFailed: string;
    loadFailed: string;
    /** Hover text on the Kanban step "follow default" option. */
    followDefaultHint: string;
    followDefaultHintNoTier: string;
    hintSourceSpecialist: string;
    hintSourceGlobal: string;
    hintSourceCode: string;
    /** Reasoning effort per tier (dropdown next to the model). */
    effortLabel: string;
    /** First effort option: clear the tier effort, the acp default applies. */
    followEffortDefault: string;
    /** Effective line value when no tier effort is set. */
    effortAgentDefault: string;
    effectiveEffort: string;
    effortSourceGlobal: string;
    effortSourceDefault: string;
    /** Appended to the step "follow default" hover text; {effort}, {tier}. */
    hintEffortGlobal: string;
    hintEffortDefault: string;
  };
}
