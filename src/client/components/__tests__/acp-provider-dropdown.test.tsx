/**
 * Provider dropdown: unavailable providers stay listed but cannot be picked
 * (card f1bc30c7 AC6 / contract C6).
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AcpProviderInfo } from "../../acp-client";
import { saveProviderDisplayPreferences } from "../../utils/custom-acp-providers";
import { AcpProviderDropdown } from "../acp-provider-dropdown";

const providers: AcpProviderInfo[] = [
  { id: "opencode", name: "OpenCode", description: "OpenCode CLI", command: "opencode", status: "available" },
  { id: "gemini", name: "Gemini", description: "Gemini CLI", command: "gemini", status: "checking" },
  {
    id: "codex",
    name: "Codex",
    description: "Codex CLI",
    command: "codex-acp",
    status: "unavailable",
    unavailableReason: "codex-acp is not installed or not in PATH",
  },
  // Rust backend: unavailable without a reason → title falls back to description.
  { id: "kimi", name: "Kimi", description: "Kimi CLI", command: "kimi", status: "unavailable" },
];

function renderDropdown(selectedProvider: string, onProviderChange = vi.fn()) {
  const view = render(
    <AcpProviderDropdown
      providers={providers}
      selectedProvider={selectedProvider}
      onProviderChange={onProviderChange}
      dataTestId="provider-dropdown"
    />,
  );
  return { ...view, onProviderChange };
}

function openPanel() {
  fireEvent.click(screen.getByTestId("provider-dropdown"));
  return screen.getByTestId("provider-dropdown-panel");
}

function providerButton(panel: HTMLElement, name: string): HTMLButtonElement {
  return within(panel).getByText(name).closest("button") as HTMLButtonElement;
}

describe("AcpProviderDropdown unavailable providers", () => {
  beforeEach(() => {
    window.localStorage.clear();
    saveProviderDisplayPreferences({ visibleProviderIds: providers.map((provider) => provider.id) });
  });

  it.each([
    ["Codex", "codex-acp is not installed or not in PATH"],
    ["Kimi", "Kimi CLI"],
  ])("%s stays visible, is disabled and greyed, and clicking it does not select it", (name, title) => {
    const { onProviderChange } = renderDropdown("opencode");
    const panel = openPanel();
    const button = providerButton(panel, name);

    expect(button.isConnected).toBe(true);
    expect(button.hidden).toBe(false);
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.className).toContain("cursor-not-allowed");
    expect(button.className).toContain("opacity-50");
    expect(button.getAttribute("title")).toBe(title);

    fireEvent.click(button);
    expect(onProviderChange).toHaveBeenCalledTimes(0);
  });

  it.each([
    ["OpenCode", "opencode"],
    ["Gemini", "gemini"],
  ])("%s (available / checking) is selectable", (name, id) => {
    const { onProviderChange } = renderDropdown("codex");
    const button = providerButton(openPanel(), name);

    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-disabled")).toBe("false");
    fireEvent.click(button);
    expect(onProviderChange).toHaveBeenCalledTimes(1);
    expect(onProviderChange).toHaveBeenCalledWith(id);
  });

  it("keeps showing a selected provider that becomes unavailable and does not switch away", () => {
    const onProviderChange = vi.fn();
    const available = providers.map((provider) =>
      provider.id === "codex" ? { ...provider, status: "available" as const, unavailableReason: undefined } : provider);
    const { rerender } = render(
      <AcpProviderDropdown providers={available} selectedProvider="codex" onProviderChange={onProviderChange} dataTestId="provider-dropdown" />,
    );
    expect(screen.getByTestId("provider-dropdown").textContent).toContain("Codex");

    rerender(
      <AcpProviderDropdown providers={providers} selectedProvider="codex" onProviderChange={onProviderChange} dataTestId="provider-dropdown" />,
    );

    expect(screen.getByTestId("provider-dropdown").textContent).toContain("Codex");
    const selected = providerButton(openPanel(), "Codex");
    expect(selected.className).toContain("bg-blue-50");
    expect(selected.disabled).toBe(true);
    expect(onProviderChange).toHaveBeenCalledTimes(0);
  });
});
