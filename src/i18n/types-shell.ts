import type { RedesignSettingsTranslationDictionarySections } from "./types-redesign-settings";

/**
 * Copy for the redesigned app shell (sidebar, top bar, command palette,
 * settings sub-navigation) and the shared UI primitives under
 * src/client/components/ui. Kept in its own section so later redesign
 * cards can extend it without growing the legacy dictionaries.
 */
export interface ShellTranslationDictionarySections extends RedesignSettingsTranslationDictionarySections {
  shell: {
    /** Sidebar entries, in display order. */
    nav: {
      label: string;
      home: string;
      inbox: string;
      kanban: string;
      sessions: string;
      team: string;
      spec: string;
      settings: string;
      openMenu: string;
      closeMenu: string;
    };
    topbar: {
      label: string;
      openCommandPalette: string;
      commandPaletteShortcut: string;
    };
    commandPalette: {
      title: string;
      placeholder: string;
      noResults: string;
      resultsLabel: string;
      /** Hint appended to entries that land on a list page instead of a specific ID. */
      opensList: string;
      groups: {
        workspace: string;
        settings: string;
        resources: string;
        developer: string;
      };
      routes: {
        home: string;
        workspaceEntry: string;
        inbox: string;
        kanban: string;
        sessions: string;
        sessionDetail: string;
        team: string;
        teamRun: string;
        spec: string;
        featureExplorer: string;
        reposlide: string;
        settings: string;
        agents: string;
        specialists: string;
        workflows: string;
        mcp: string;
        schedules: string;
        webhooks: string;
        harness: string;
        fitness: string;
        fluency: string;
        traces: string;
        messages: string;
        a2a: string;
        agUi: string;
        mcpTools: string;
        canvas: string;
        acpReplay: string;
        officeLab: string;
      };
    };
    settingsNav: {
      label: string;
      groups: {
        overview: string;
        build: string;
        integrations: string;
        automation: string;
        quality: string;
      };
      items: {
        overview: string;
        agents: string;
        specialists: string;
        workflows: string;
        mcp: string;
        mcpTools: string;
        schedules: string;
        webhooks: string;
        harness: string;
        fitness: string;
        fluency: string;
      };
    };
  };
  uiKit: {
    tone: {
      neutral: string;
      info: string;
      attention: string;
      danger: string;
      success: string;
    };
    loading: string;
    retry: string;
    errorTitle: string;
    emptyTitle: string;
  };
}
