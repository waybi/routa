/**
 * Team launch box "model · reasoning effort" capsule (card 15: AC1–AC3, AC6;
 * contract C3–C6, F3 ②, F4 ⑥ ⑦). The real HomeInput and ModelEffortPicker
 * render; only TiptapInput, data hooks and fetch are stubbed. Expected values
 * are written from the card text, not computed by the code under test.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TeamLaunchPanel } from "../team-launch-panel";
import { HomeInput } from "@/client/components/home-input";
import { AcpProviderDropdown } from "@/client/components/acp-provider-dropdown";
import { resolvePanelLeft, PANEL_MIN_WIDTH } from "@/client/components/model-effort-picker";
import { resetModelEffortChoicesCache } from "@/client/model-effort/use-model-effort-choices";
import zh from "@/i18n/locales/zh";
import en from "@/i18n/locales/en";

const h = vi.hoisted(() => ({
  i18n: { locale: "zh" as "zh" | "en" },
  acp: { selectedProvider: "claude", providers: [] as Array<{ id: string; name: string; status?: string }> },
  createSession: vi.fn(),
  setProvider: vi.fn(),
  fetch: vi.fn(),
  tiptap: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/i18n", () => ({
  useTranslation: () => ({ t: h.i18n.locale === "en" ? en : zh, locale: h.i18n.locale, setLocale: () => {} }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/client/components/tiptap-input", () => ({
  TiptapInput: (props: Record<string, unknown> & {
    onSend: (text: string, context: Record<string, unknown>) => Promise<void>;
    onProviderChange?: (provider: string) => void;
    repoSelection?: { path?: string } | null;
    beforeProviderSlot?: React.ReactNode;
  }) => {
    h.tiptap.push(props);
    return (
      <div>
        <div data-testid="selected-provider">{String(props.selectedProvider)}</div>
        {props.beforeProviderSlot}
        <button type="button" onClick={() => void props.onSend("Fix the bug", { cwd: props.repoSelection?.path })}>send</button>
        <button type="button" onClick={() => props.onProviderChange?.("claude")}>switch-to-claude</button>
      </div>
    );
  },
}));
vi.mock("@/client/hooks/use-acp", () => ({
  useAcp: () => ({
    connected: true,
    loading: false,
    providers: h.acp.providers,
    selectedProvider: h.acp.selectedProvider,
    setProvider: h.setProvider,
    connect: vi.fn(),
    createSession: h.createSession,
    promptSession: vi.fn(),
    listProviderModels: vi.fn(),
    dockerConfigError: null,
    clearDockerConfigError: vi.fn(),
  }),
}));
vi.mock("@/client/hooks/use-skills", () => ({
  useSkills: (() => {
    const skills = { skills: [], repoSkills: [], loadRepoSkills: () => {}, clearRepoSkills: () => {} };
    return () => skills;
  })(),
}));
vi.mock("@/client/hooks/use-workspaces", () => {
  // Stable references: HomeInput effects depend on these arrays.
  const workspaces = { workspaces: [{ id: "ws-1", title: "Workspace" }] };
  const codebases = { codebases: [{ id: "cb-1", workspaceId: "ws-1", repoPath: "/repo/main", branch: "main", label: "routa", isDefault: true }] };
  return { useWorkspaces: () => workspaces, useCodebases: () => codebases };
});
vi.mock("@/client/utils/pending-prompt", () => ({ storePendingPrompt: vi.fn() }));
vi.mock("@/client/utils/diagnostics", () => ({ desktopAwareFetch: h.fetch }));
vi.mock("@/client/utils/repo-validation", () => ({ collectAccessibleRepoPaths: async () => new Set(["/repo/main"]) }));
vi.mock("@/client/components/settings-panel", () => ({
  loadProviderConnectionConfig: () => ({}),
  getModelDefinitionByAlias: () => undefined,
  DockerConfigModal: () => null,
  SettingsPanel: () => null,
}));

const DSH_OPTIONS = {
  configOptions: [
    {
      id: "model",
      currentValue: JSON.stringify(["local-7357", "claude-opus-5-5-pool"]),
      options: [
        { group: "deepseek-official", name: "DeepSeek", options: [
          { value: JSON.stringify(["deepseek-official", "deepseek-v4-pro"]), name: "DeepSeek V4 Pro" },
          { value: JSON.stringify(["deepseek-official", "deepseek-flash"]), name: "DeepSeek Flash" },
        ] },
        { group: "local-7357", name: "Local 7357", options: [
          { value: JSON.stringify(["local-7357", "claude-opus-5-5-pool"]), name: "Claude Opus 5.5 (Pool)" },
          { value: JSON.stringify(["local-7357", "gpt-6.1-sol"]), name: "GPT 6.1 Sol" },
          { value: JSON.stringify(["local-7357", "deepseek-v4-local"]), name: "DeepSeek V4 Local" },
        ] },
      ],
    },
    { id: "reasoning_effort", currentValue: "high", options: ["", "low", "medium", "high", "xhigh", "max"].map((value) => ({ value, name: value || "default" })) },
  ],
};

type ConfigReply = "ok" | "empty" | 502 | 404 | "reject";
let configReplies: Record<string, ConfigReply> = {};

function stubFetch() {
  h.fetch.mockImplementation(async (url: string) => {
    const match = /\/api\/providers\/([^/]+)\/config-options/.exec(String(url));
    if (!match) return { ok: true, status: 200, json: async () => ({ specialists: [] }) };
    const reply = configReplies[decodeURIComponent(match[1])] ?? 502;
    if (reply === "reject") throw new TypeError("Failed to fetch");
    if (reply === "ok") return { ok: true, status: 200, json: async () => DSH_OPTIONS };
    if (reply === "empty") return { ok: true, status: 200, json: async () => ({ configOptions: [{ id: "model", options: [] }] }) };
    return { ok: false, status: reply, json: async () => ({ error: "Preset claude uses a non-standard API" }) };
  });
}

const copy = () => (h.i18n.locale === "en" ? en : zh).teamRedesign;
const PICKED_KEY = "routa.acp.providerPickedInComposer";

/** The user picked `provider` in a composer earlier (use-acp restores it as the selected provider). */
function pickProvider(provider: string) {
  window.localStorage.setItem(PICKED_KEY, "1");
  window.localStorage.setItem("routa.acp.selectedProvider", provider);
  h.acp.selectedProvider = provider;
}

function renderPanel() {
  return render(
    <TeamLaunchPanel
      id="team-launch"
      copy={copy()}
      modeCopy={{ label: "Team", description: "Team run", placeholder: "Describe the task" }}
      workspaceId="ws-1"
      onTemplate={() => {}}
      onSessionCreated={() => {}}
    />,
  );
}

/** Assertion-based lookups, so a missing capsule / panel fails as an AssertionError. */
function present(testId: string): HTMLElement {
  const element = screen.queryByTestId(testId);
  expect(element, `${testId} is rendered`).not.toBeNull();
  return element as HTMLElement;
}
const capsule = () => present("team-model-effort-picker");
const capsuleLabel = () => present("team-model-effort-picker-label").textContent;
const configRequested = (provider: string) =>
  h.fetch.mock.calls.some(([url]) => String(url).includes(`/api/providers/${provider}/config-options`));

async function openReadyPanel() {
  renderPanel();
  await waitFor(() => expect(capsule().hasAttribute("disabled")).toBe(false));
  fireEvent.click(capsule());
  return present("team-model-effort-picker-panel");
}

beforeEach(() => {
  h.i18n.locale = "zh";
  h.tiptap.length = 0;
  h.createSession.mockReset().mockResolvedValue({ sessionId: "team-session-1" });
  h.setProvider.mockReset().mockImplementation((provider: string) => {
    window.localStorage.setItem("routa.acp.selectedProvider", provider);
    h.acp.selectedProvider = provider;
  });
  h.fetch.mockReset();
  h.acp.selectedProvider = "claude";
  h.acp.providers = [
    { id: "claude", name: "Claude Code" },
    { id: "dsh", name: "DeepSeek Harness" },
    { id: "opencode", name: "OpenCode" },
  ];
  window.localStorage.clear();
  resetModelEffortChoicesCache();
  configReplies = { dsh: "ok", claude: 502, opencode: 404 };
  stubFetch();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("C3 capsule is always shown; disabled when the provider lists no models", () => {
  it.each([
    ["① 502 (Claude Code)", 502],
    ["② 404 (desktop backend without the route)", 404],
    ["③ network error", "reject"],
    ["④ 200 with an empty model list", "empty"],
  ] as const)("%s", async (_name, reply) => {
    pickProvider("claude");
    configReplies.claude = reply;
    renderPanel();
    await waitFor(() => expect(configRequested("claude")).toBe(true));
    await act(async () => {});

    expect(capsule().hasAttribute("disabled")).toBe(true);
    expect(capsuleLabel()).toBe("跟随默认");
    expect(capsule().getAttribute("title")).toBe("这个 Provider 不支持在这里选模型");
    fireEvent.click(capsule());
    expect(screen.queryByTestId("team-model-effort-picker-panel")).toBeNull();
  });

  it("⑤ dsh options: clickable, grouped, searchable across groups, effort segments 默认…最高", async () => {
    const panel = await openReadyPanel();
    expect(capsuleLabel()).toBe("跟随默认 · 默认");

    const groups = within(panel).getAllByRole("group").map((group) => group.getAttribute("aria-label"));
    expect(groups).toEqual(["DeepSeek", "Local 7357"]);
    const search = screen.getByTestId("team-model-effort-picker-search");
    expect(document.activeElement).toBe(search);

    fireEvent.change(search, { target: { value: "deepseek v4" } });
    expect(within(panel).getAllByRole("option").map((option) => option.textContent)).toEqual(["DeepSeek V4 Pro", "DeepSeek V4 Local"]);
    fireEvent.change(search, { target: { value: "no-such-model" } });
    expect(within(panel).queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByTestId("team-model-effort-picker-no-match").textContent).toBe("没有匹配的模型");

    expect(within(panel).getAllByRole("radio").map((radio) => [radio.textContent, radio.getAttribute("data-value")])).toEqual([
      ["默认", ""], ["低", "low"], ["中", "medium"], ["高", "high"], ["很高", "xhigh"], ["最高", "max"],
    ]);
    expect(screen.getByTestId("team-model-effort-picker-note").textContent).toContain("同一个 Provider");
  });

  it("Escape closes and focus returns to the capsule", async () => {
    const panel = await openReadyPanel();
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByTestId("team-model-effort-picker-panel")).toBeNull();
    expect(document.activeElement).toBe(capsule());
  });

  it("an outside click closes and focus returns to the capsule", async () => {
    await openReadyPanel();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId("team-model-effort-picker-panel")).toBeNull();
    expect(document.activeElement).toBe(capsule());
  });

  it("capsule reads 「模型名 · 推理等级」 after a pick", async () => {
    const panel = await openReadyPanel();
    fireEvent.click(within(panel).getByRole("option", { name: "GPT 6.1 Sol" }));
    fireEvent.click(within(panel).getByRole("radio", { name: "高" }));
    expect(capsuleLabel()).toBe("GPT 6.1 Sol · 高");
  });

  it("C16: English copy", async () => {
    h.i18n.locale = "en";
    pickProvider("claude");
    renderPanel();
    await waitFor(() => expect(configRequested("claude")).toBe(true));
    await act(async () => {});
    expect(capsuleLabel()).toBe("Follow default");
    expect(capsule().getAttribute("title")).toBe("This provider does not support choosing a model here");
  });
});

describe("C4 the pick travels with the create-session request", () => {
  const sentModelEffort = () => {
    const args = h.createSession.mock.calls[0];
    return { provider: args[1], model: args[5], reasoningEffort: args[19] };
  };

  async function send() {
    await waitFor(() => expect(h.tiptap.at(-1)?.repoSelection).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "send" }));
    await waitFor(() => expect(h.createSession).toHaveBeenCalledTimes(1));
  }

  it("① Local 7357 model + 高 → that model id and high", async () => {
    const panel = await openReadyPanel();
    fireEvent.click(within(panel).getByRole("option", { name: "GPT 6.1 Sol" }));
    fireEvent.click(within(panel).getByRole("radio", { name: "高" }));
    await send();
    expect(sentModelEffort()).toEqual({ provider: "dsh", model: "gpt-6.1-sol", reasoningEffort: "high" });
  });

  it("② nothing picked → neither model nor effort", async () => {
    renderPanel();
    await waitFor(() => expect(capsule().hasAttribute("disabled")).toBe(false));
    await send();
    expect(sentModelEffort()).toEqual({ provider: "dsh", model: undefined, reasoningEffort: undefined });
  });

  it("③ picked, then switched to Claude Code (502) → neither field", async () => {
    const view = renderPanel();
    await waitFor(() => expect(capsule().hasAttribute("disabled")).toBe(false));
    fireEvent.click(capsule());
    const panel = present("team-model-effort-picker-panel");
    fireEvent.click(within(panel).getByRole("option", { name: "GPT 6.1 Sol" }));
    fireEvent.click(within(panel).getByRole("radio", { name: "高" }));
    fireEvent.click(screen.getByRole("button", { name: "switch-to-claude" }));
    view.rerender(
      <TeamLaunchPanel id="team-launch" copy={copy()} modeCopy={{ label: "Team", description: "Team run", placeholder: "x" }}
        workspaceId="ws-1" onTemplate={() => {}} onSessionCreated={() => {}} />,
    );
    await waitFor(() => expect(capsule().hasAttribute("disabled")).toBe(true));
    await send();
    expect(sentModelEffort()).toEqual({ provider: "claude", model: undefined, reasoningEffort: undefined });
  });

  it("④ model with effort 默认 → model only", async () => {
    const panel = await openReadyPanel();
    fireEvent.click(within(panel).getByRole("option", { name: "DeepSeek V4 Local" }));
    await send();
    expect(sentModelEffort()).toEqual({ provider: "dsh", model: "deepseek-v4-local", reasoningEffort: undefined });
  });
});

describe("C5 default provider of the team launch box", () => {
  it("① never picked and dsh available → dsh (even after use-acp stored its own default)", async () => {
    // use-acp writes the first available provider on every connect; that is not a user pick.
    window.localStorage.setItem("routa.acp.selectedProvider", "claude");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("selected-provider").textContent).toBe("dsh"));
    await waitFor(() => expect(configRequested("dsh")).toBe(true));
    expect(window.localStorage.getItem(PICKED_KEY)).toBeNull();
  });

  it("a pick in the launch box is remembered and wins from then on", async () => {
    const view = renderPanel();
    await waitFor(() => expect(screen.getByTestId("selected-provider").textContent).toBe("dsh"));
    fireEvent.click(screen.getByRole("button", { name: "switch-to-claude" }));
    expect(window.localStorage.getItem(PICKED_KEY)).toBe("1");
    view.rerender(
      <TeamLaunchPanel id="team-launch" copy={copy()} modeCopy={{ label: "Team", description: "Team run", placeholder: "x" }}
        workspaceId="ws-1" onTemplate={() => {}} onSessionCreated={() => {}} />,
    );
    expect(screen.getByTestId("selected-provider").textContent).toBe("claude");
  });

  it("② nothing stored and no dsh → the previous default", async () => {
    h.acp.providers = [{ id: "claude", name: "Claude Code" }];
    renderPanel();
    await act(async () => {});
    expect(screen.getByTestId("selected-provider").textContent).toBe("claude");
    expect(capsule()).toBeTruthy();
  });

  it.each(["claude", "opencode"])("③④ user picked %s → that provider", async (stored) => {
    pickProvider(stored);
    renderPanel();
    await act(async () => {});
    expect(screen.getByTestId("selected-provider").textContent).toBe(stored);
  });

  it("⑤ HomeInput without the new props (home page): unchanged default, no capsule id change, nothing stored", async () => {
    configReplies.claude = 502;
    render(<HomeInput workspaceId="ws-1" />);
    await waitFor(() => expect(configRequested("claude")).toBe(true));
    await act(async () => {});
    expect(screen.getByTestId("selected-provider").textContent).toBe("claude");
    expect(screen.queryByTestId("home-model-effort-picker")).toBeNull();
    expect(screen.queryByTestId("team-model-effort-picker")).toBeNull();
    expect(window.localStorage.getItem("routa.acp.selectedProvider")).toBeNull();
    expect(window.localStorage.getItem(PICKED_KEY)).toBeNull();
  });
});

describe("C6 panels stay inside the viewport", () => {
  function setViewport(width: number) {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
  }

  function stubRect(left: number, width: number) {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left, right: left + width, width, top: 500, bottom: 528, height: 28, x: left, y: 500, toJSON: () => ({}),
    } as DOMRect);
  }

  const cases = [1440, 768].flatMap((width) => [
    { width, place: "left", left: 120 },
    { width, place: "right edge", left: width - 4 - 150 },
  ]);

  it.each(cases)("model panel at $width px, button $place", async ({ width, left }) => {
    setViewport(width);
    renderPanel();
    await waitFor(() => expect(capsule().hasAttribute("disabled")).toBe(false));
    stubRect(left, 150);
    fireEvent.click(capsule());
    const panel = present("team-model-effort-picker-panel");
    const panelLeft = Number.parseFloat(panel.style.left);
    const panelWidth = Number.parseFloat(panel.style.width);
    expect(panelLeft).toBeGreaterThanOrEqual(0);
    expect(panelLeft + panelWidth).toBeLessThanOrEqual(width);
  });

  it.each(cases.flatMap((c) => [{ ...c, variant: "compact" as const, panelWidth: 288 }, { ...c, variant: "hero" as const, panelWidth: 320 }]))(
    "provider menu ($variant) at $width px, button $place",
    ({ width, left, variant, panelWidth }) => {
      setViewport(width);
      render(
        <AcpProviderDropdown
          providers={[{ id: "dsh", name: "DeepSeek Harness", description: "", command: "dsh", status: "available" }]}
          selectedProvider="dsh"
          onProviderChange={() => {}}
          variant={variant}
          dataTestId="provider-menu"
        />,
      );
      stubRect(left, 150);
      fireEvent.click(screen.getByTestId("provider-menu"));
      const menuLeft = Number.parseFloat(present("provider-menu-panel").style.left);
      expect(menuLeft).toBeGreaterThanOrEqual(0);
      expect(menuLeft + panelWidth).toBeLessThanOrEqual(width);
      if (left + panelWidth <= width - 8) expect(menuLeft).toBe(left); // old position kept when it fits
    },
  );
});

describe("random cross-check of panel placement (F3 ②)", () => {
  // Judge from the card: inside [0, innerWidth]; when it fits from the button's left edge (8 px margins), stay there.
  function judgeOk(left: number, rectLeft: number, panelWidth: number, viewport: number) {
    if (left < 0 || left + panelWidth > viewport) return false;
    const fits = rectLeft >= 8 && rectLeft + panelWidth <= viewport - 8;
    return fits ? left === rectLeft : true;
  }

  function cases(seed: number) {
    let state = seed >>> 0;
    const rand = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    return Array.from({ length: 10_000 }, () => {
      const viewport = 320 + Math.floor(rand() * 2241);
      const buttonWidth = 20 + Math.floor(rand() * 181);
      const rectLeft = Math.floor(rand() * Math.max(1, viewport - buttonWidth));
      const panelWidth = Math.min(PANEL_MIN_WIDTH + Math.floor(rand() * 200), viewport - 16);
      return { viewport, rectLeft, rect: { left: rectLeft, right: rectLeft + buttonWidth }, panelWidth };
    });
  }

  const failures = (place: typeof resolvePanelLeft) =>
    cases(20261024).filter((c) => !judgeOk(place(c.rect, c.panelWidth, c.viewport), c.rectLeft, c.panelWidth, c.viewport)).length;

  it("the judge catches a planted +20 px bug", () => {
    expect(failures((rect, width, viewport) => resolvePanelLeft(rect, width, viewport) + 20)).toBeGreaterThan(0);
  });

  it("10,000 random placements agree with the judge", () => {
    expect(failures(resolvePanelLeft)).toBe(0);
  });
});
