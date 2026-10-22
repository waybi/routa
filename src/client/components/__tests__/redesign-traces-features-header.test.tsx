import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import en from "@/i18n/locales/en";

import { TracesPageHeader } from "../traces-page-header";
import { TracesViewTabs } from "../traces-view-tabs";
import { FeatureExplorerPageHeader } from "@/app/workspace/[workspaceId]/feature-explorer/feature-explorer-page-header";

/**
 * Redesign card 6/6, AC8 (QA round 3): /traces and feature-explorer use the
 * shared 21px page header with the page actions on the right.
 */

describe("TracesPageHeader", () => {
  it("renders the shared 21px header with copy, sidebar and refresh on the right", () => {
    const onCopy = vi.fn();
    const onToggle = vi.fn();
    const onRefresh = vi.fn();
    render(
      <TracesPageHeader
        selectedSessionId="session-1234567890"
        showSidebar
        loading={false}
        onCopyCurrentUrl={onCopy}
        onToggleSidebar={onToggle}
        onRefresh={onRefresh}
      />,
    );

    const wrapper = screen.getByTestId("traces-page-header");
    const header = within(wrapper).getByTestId("settings-page-header");
    const heading = within(header).getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe(en.pagesRedesign.headers.traces.title);
    expect(heading.className).toContain("text-[21px]");
    expect(within(header).getByText(en.pagesRedesign.headers.traces.description)).toBeTruthy();

    const actions = within(header).getByTestId("settings-page-header-actions");
    expect(within(actions).getByTestId("traces-selected-session").textContent).toContain("session-");
    fireEvent.click(within(actions).getByRole("button", { name: new RegExp(en.traces.copyLink) }));
    fireEvent.click(within(actions).getByRole("button", { name: en.traces.hideSessions }));
    fireEvent.click(within(actions).getByRole("button", { name: en.common.refresh }));
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(wrapper.innerHTML).not.toContain("desktop-");
  });

  it("marks the active trace tab with aria-pressed", () => {
    const onTabChange = vi.fn();
    render(<TracesViewTabs activeTab="chat" onTabChange={onTabChange} />);
    const tabs = within(screen.getByTestId("traces-view-tabs")).getAllByRole("button");
    expect(tabs.map((tab) => tab.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
    fireEvent.click(tabs[1]);
    expect(onTabChange).toHaveBeenCalledWith("event-bridge");
  });
});

describe("FeatureExplorerPageHeader", () => {
  it("renders the shared 21px header with generate and refresh actions on the right", () => {
    const onGenerate = vi.fn();
    const onRefresh = vi.fn();
    render(
      <FeatureExplorerPageHeader
        onGenerate={onGenerate}
        onRefreshFrictionProfiles={onRefresh}
        refreshDisabled={false}
        isRefreshingFrictionProfiles={false}
      />,
    );

    const header = screen.getByTestId("settings-page-header");
    const heading = within(header).getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe(en.pagesRedesign.headers.featureExplorer.title);
    expect(heading.className).toContain("text-[21px]");

    const actions = within(header).getByTestId("settings-page-header-actions");
    fireEvent.click(within(actions).getByTestId("generate-feature-tree-button"));
    fireEvent.click(within(actions).getByTestId("refresh-friction-profiles-button"));
    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("disables refresh while there is no repository", () => {
    render(
      <FeatureExplorerPageHeader
        onGenerate={vi.fn()}
        onRefreshFrictionProfiles={vi.fn()}
        refreshDisabled
        isRefreshingFrictionProfiles={false}
      />,
    );
    expect((screen.getByTestId("refresh-friction-profiles-button") as HTMLButtonElement).disabled).toBe(true);
  });
});
