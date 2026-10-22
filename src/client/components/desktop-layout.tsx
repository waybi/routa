"use client";

/**
 * Desktop Layout — convenience wrapper that wires the workspace switcher
 * into the shared DesktopAppShell, so both entry points render the same
 * redesigned sidebar, top bar and command palette.
 */

import React from "react";

import type { WorkspaceData } from "@/client/hooks/use-workspaces";
import { DesktopAppShell } from "./desktop-app-shell";
import { WorkspaceSwitcher } from "./workspace-switcher";

interface DesktopLayoutProps {
  children: React.ReactNode;
  workspaceId: string;
  workspaces: WorkspaceData[];
  activeWorkspaceTitle?: string;
  workspacesLoading?: boolean;
  onWorkspaceSelect: (wsId: string) => void;
  onWorkspaceCreate: (title: string) => Promise<void>;
  /** Optional right side content for the title bar */
  titleBarRight?: React.ReactNode;
}

export function DesktopLayout({
  children,
  workspaceId,
  workspaces,
  activeWorkspaceTitle,
  workspacesLoading,
  onWorkspaceSelect,
  onWorkspaceCreate,
  titleBarRight,
}: DesktopLayoutProps) {
  return (
    <DesktopAppShell
      workspaceId={workspaceId}
      workspaceTitle={activeWorkspaceTitle}
      titleBarRight={titleBarRight}
      workspaceSwitcher={(
        <WorkspaceSwitcher
          workspaces={workspaces}
          activeWorkspaceId={workspaceId}
          activeWorkspaceTitle={activeWorkspaceTitle}
          onSelect={onWorkspaceSelect}
          onCreate={onWorkspaceCreate}
          loading={workspacesLoading}
          compact
        />
      )}
    >
      {children}
    </DesktopAppShell>
  );
}
