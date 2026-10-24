"use client";

import { type ReactNode, useState } from "react";

import { Tabs } from "@/client/components/ui/tabs";
import { useTranslation } from "@/i18n";

import { SessionEventsPane } from "./session-events-pane";
import { SessionEvidencePane, type KnownSessionContext } from "./session-evidence-pane";
import { useSessionTraces } from "./use-session-traces";

export type SessionDetailTab = "chat" | "events" | "evidence";

export interface SessionDetailTabsProps {
  sessionId: string;
  workspaceId: string;
  /** The chat column (ChatPanel). Rendered once and kept mounted across tab switches. */
  chat: ReactNode;
  knownContext?: KnownSessionContext | null;
  /**
   * Optional: receives the element at the end of the tab row. The page
   * portals ChatPanel's session info (ID, Debug, Chat/Trace) into it so the
   * tabs and that info share one line. The slot is hidden outside the Chat tab.
   */
  onTrailingSlot?: (node: HTMLDivElement | null) => void;
}

/**
 * Chat / Events / Evidence (prototype `sessionPage()` + `case 'session-tab'`).
 * Tabs keep every panel mounted: switching away from chat must not unmount
 * ChatPanel, or the draft, scroll position, stream subscription and the
 * pending re-send after Resume would be lost (keep-list item 25).
 */
export function SessionDetailTabs({ sessionId, workspaceId, chat, knownContext, onTrailingSlot }: SessionDetailTabsProps) {
  const { t } = useTranslation();
  const copy = t.sessionDetailRedesign.tabs;
  const [tab, setTab] = useState<SessionDetailTab>("chat");
  const [opened, setOpened] = useState<{ sessionId: string; events: boolean; evidence: boolean }>({
    sessionId,
    events: false,
    evidence: false,
  });
  const openedForSession = opened.sessionId === sessionId ? opened : { sessionId, events: false, evidence: false };
  const tracesEnabled = openedForSession.events || openedForSession.evidence || tab !== "chat";
  const traces = useSessionTraces(sessionId, tracesEnabled);

  const handleChange = (next: string) => {
    const value = next as SessionDetailTab;
    setTab(value);
    if (value === "events" || value === "evidence") {
      setOpened((prev) => {
        const base = prev.sessionId === sessionId ? prev : { sessionId, events: false, evidence: false };
        return { ...base, [value]: true };
      });
    }
  };

  return (
    <Tabs
      label={copy.label}
      value={tab}
      onChange={handleChange}
      keepMounted
      compact={onTrailingSlot !== undefined}
      trailing={onTrailingSlot ? (
        <div
          ref={onTrailingSlot}
          hidden={tab !== "chat"}
          className="flex min-w-0 flex-1 items-center pr-4 md:pr-[22px]"
          data-testid="session-tabs-trailing"
        />
      ) : undefined}
      className="flex min-h-0 flex-1 flex-col"
      listClassName="px-4 md:px-[22px]"
      panelClassName="flex min-h-0 flex-1 flex-col overflow-hidden"
      items={[
        { id: "chat", label: copy.chat, content: chat },
        {
          id: "events",
          label: copy.events,
          content: <SessionEventsPane workspaceId={workspaceId} traces={traces} />,
        },
        {
          id: "evidence",
          label: copy.evidence,
          content: (
            <SessionEvidencePane
              sessionId={sessionId}
              workspaceId={workspaceId}
              opened={openedForSession.evidence || tab === "evidence"}
              knownContext={knownContext}
              traces={traces}
            />
          ),
        },
      ]}
    />
  );
}
