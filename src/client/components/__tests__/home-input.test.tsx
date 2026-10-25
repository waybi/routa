import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HomeInput, resolveHomeInputSpecialistId } from "../home-input";
import { resetModelEffortChoicesCache } from "../../model-effort/use-model-effort-choices";
import { COMPOSER_PROVIDER_PICKED_KEY } from "../../hooks/acp-provider-choice";

const {
  pushMock,
  createSessionMock,
  promptSessionMock,
  listProviderModelsMock,
  setProviderMock,
  clearDockerConfigErrorMock,
  loadRepoSkillsMock,
  clearRepoSkillsMock,
  useWorkspacesMock,
  useCodebasesMock,
  storePendingPromptMock,
  desktopAwareFetchMock,
  collectAccessibleRepoPathsMock,
  loadProviderConnectionConfigMock,
  getModelDefinitionByAliasMock,
  acpState,
  tiptapProps,
} = vi.hoisted(() => ({
  pushMock: vi.fn(),
  createSessionMock: vi.fn(),
  promptSessionMock: vi.fn(),
  listProviderModelsMock: vi.fn(),
  setProviderMock: vi.fn(),
  clearDockerConfigErrorMock: vi.fn(),
  loadRepoSkillsMock: vi.fn(),
  clearRepoSkillsMock: vi.fn(),
  useWorkspacesMock: vi.fn(),
  useCodebasesMock: vi.fn(),
  storePendingPromptMock: vi.fn(),
  desktopAwareFetchMock: vi.fn(),
  collectAccessibleRepoPathsMock: vi.fn(),
  loadProviderConnectionConfigMock: vi.fn(),
  getModelDefinitionByAliasMock: vi.fn(),
  acpState: {
    selectedProvider: "provider-default",
    providers: [{ id: "provider-x", name: "Provider X" }] as Array<{ id: string; name: string; status?: string }>,
  },
  tiptapProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock("../tiptap-input", () => ({
  TiptapInput: (props: {
    onSend: (text: string, context: Record<string, unknown>) => Promise<void>;
    pendingSkill?: string | null;
    disabled?: boolean;
    repoSelection?: { path?: string; name?: string; branch?: string } | null;
    skills?: Array<{ name: string }>;
    repoSkills?: Array<{ name: string }>;
    beforeProviderSlot?: React.ReactNode;
  }) => (tiptapProps.push(props as Record<string, unknown>), (
    <div>
      <div data-testid="pending-skill">{props.pendingSkill ?? ""}</div>
      <div data-testid="repo-selection">{props.repoSelection?.path ?? ""}</div>
      <div data-testid="disabled-state">{String(Boolean(props.disabled))}</div>
      <div data-testid="skills-count">{props.skills?.length ?? 0}</div>
      <div data-testid="repo-skills-count">{props.repoSkills?.length ?? 0}</div>
      {props.beforeProviderSlot}
      <button
        type="button"
        onClick={() => void props.onSend("Ship it", { cwd: props.repoSelection?.path })}
      >
        Send default toolbar
      </button>
      <button
        type="button"
        onClick={() => void props.onSend("Ship it", {
          cwd: props.repoSelection?.path,
          provider: "provider-x",
          mode: "mode-fast",
          model: "alias-model",
          skill: props.pendingSkill || undefined,
        })}
      >
        Send
      </button>
    </div>
  )),
}));

vi.mock("../settings-panel", () => ({
  loadProviderConnectionConfig: loadProviderConnectionConfigMock,
  getModelDefinitionByAlias: getModelDefinitionByAliasMock,
  DockerConfigModal: () => null,
}));

vi.mock("../../hooks/use-acp", () => ({
  useAcp: () => ({
    connected: true,
    loading: false,
    providers: acpState.providers,
    selectedProvider: acpState.selectedProvider,
    setProvider: setProviderMock,
    connect: vi.fn(),
    createSession: createSessionMock,
    promptSession: promptSessionMock,
    listProviderModels: listProviderModelsMock,
    dockerConfigError: null,
    clearDockerConfigError: clearDockerConfigErrorMock,
  }),
}));

vi.mock("../../hooks/use-skills", () => ({
  useSkills: () => ({
    skills: [{ name: "local-skill", description: "Local skill" }],
    repoSkills: [{ name: "repo-skill", description: "Repo skill" }],
    loadRepoSkills: loadRepoSkillsMock,
    clearRepoSkills: clearRepoSkillsMock,
  }),
}));

vi.mock("../../hooks/use-workspaces", () => ({
  useWorkspaces: () => useWorkspacesMock(),
  useCodebases: (workspaceId: string) => useCodebasesMock(workspaceId),
}));

vi.mock("../../utils/pending-prompt", () => ({
  storePendingPrompt: storePendingPromptMock,
}));

vi.mock("../../utils/diagnostics", () => ({
  desktopAwareFetch: desktopAwareFetchMock,
}));

vi.mock("@/client/utils/repo-validation", () => ({
  collectAccessibleRepoPaths: collectAccessibleRepoPathsMock,
}));

vi.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: {
      chat: {
        sessionConfig: { defaultModel: "Default model" },
      },
      kanbanModelSelection: {
        model: "Model",
        reasoningEffort: "Reasoning effort",
        followDefault: "Follow default",
        defaultEffort: "Default",
        pickerAriaLabel: "Model and reasoning effort",
        noModels: "No models",
      },
      common: {
        session: "Session",
        clearSpecialist: "Clear specialist",
        agentMode: "Agent mode",
      },
      home: {
        directDesc: "Direct coding",
        inputPlaceholder: "Describe work",
        multiAgent: "Multi-agent",
        crafter: "Crafter",
        repoPath: "Repo path",
        multiAgentDesc: "Multi-agent orchestration",
      },
      workspace: {
        workspaces: "Workspaces",
      },
      settings: {
        specialists: "Specialists",
      },
      sessionDetailRedesign: {
        composer: {
          switchToBuiltInRole: "Switch to built-in role",
          switchSpecialist: "Switch specialist",
          multiAgentHint: "Multi-agent orchestration hint",
          crafterHint: "Single-agent implementation hint",
          customSpecialistHint: "Use a custom specialist instead",
        },
      },
    },
  }),
}));

describe("HomeInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tiptapProps.length = 0;
    resetModelEffortChoicesCache();
    acpState.selectedProvider = "provider-default";
    acpState.providers = [{ id: "provider-x", name: "Provider X" }];
    window.localStorage.removeItem(COMPOSER_PROVIDER_PICKED_KEY);

    useWorkspacesMock.mockReturnValue({
      workspaces: [
        { id: "ws-1", title: "Workspace One" },
        { id: "ws-2", title: "Workspace Two" },
      ],
    });
    useCodebasesMock.mockReturnValue({
      codebases: [
        {
          id: "cb-1",
          workspaceId: "ws-1",
          repoPath: "/repo/main",
          branch: "main",
          label: "Main Repo",
          isDefault: true,
        },
      ],
    });
    collectAccessibleRepoPathsMock.mockResolvedValue(new Set(["/repo/main"]));
    desktopAwareFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        specialists: [
          {
            id: "spec-review",
            name: "Reviewer",
            role: "CRAFTER",
            defaultProvider: "provider-specialist",
            model: "special-model",
          },
        ],
      }),
    });
    createSessionMock.mockResolvedValue({ sessionId: "session-1" });
    promptSessionMock.mockResolvedValue(undefined);
    loadProviderConnectionConfigMock.mockReturnValue({
      model: "provider-default-model",
      baseUrl: "https://provider.example",
      apiKey: "secret",
    });
    getModelDefinitionByAliasMock.mockReturnValue({
      modelName: "resolved-model",
      baseUrl: "https://models.example",
      apiKey: "model-secret",
    });
  });

  it("resolves specialist ids according to lock and custom-selection rules", () => {
    expect(resolveHomeInputSpecialistId({
      lockedSpecialistId: "locked",
      allowCustomSpecialist: true,
      selectedSpecialistId: "selected",
    })).toBe("locked");

    expect(resolveHomeInputSpecialistId({
      lockedSpecialistId: undefined,
      allowCustomSpecialist: true,
      selectedSpecialistId: "selected",
    })).toBe("selected");

    expect(resolveHomeInputSpecialistId({
      lockedSpecialistId: undefined,
      allowCustomSpecialist: false,
      selectedSpecialistId: "selected",
    })).toBeNull();
  });

  it("auto-selects the first workspace, exposes repo context, and consumes external skills", async () => {
    const onWorkspaceChange = vi.fn();
    const onExternalSkillConsumed = vi.fn();

    render(
      <HomeInput
        onWorkspaceChange={onWorkspaceChange}
        externalPendingSkill="reviewer"
        onExternalSkillConsumed={onExternalSkillConsumed}
        displaySkills={[{ name: "fix-tests", description: "Fix tests" }]}
      />,
    );

    await waitFor(() => {
      expect(onWorkspaceChange).toHaveBeenCalledWith("ws-1");
    });
    await waitFor(() => {
      expect(loadRepoSkillsMock).toHaveBeenCalledWith("/repo/main");
    });
    await waitFor(() => {
      expect(screen.getByTestId("repo-selection").textContent).toBe("/repo/main");
    });

    expect(screen.getByTestId("pending-skill").textContent).toBe("reviewer");
    expect(onExternalSkillConsumed).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /fix-tests/i }));

    expect(screen.getByTestId("pending-skill").textContent).toBe("fix-tests");
  });

  it("stores pending prompts for the default dispatch mode", async () => {
    const onSessionCreated = vi.fn();

    render(
      <HomeInput
        workspaceId="ws-1"
        onSessionCreated={onSessionCreated}
        displaySkills={[{ name: "fix-tests", description: "Fix tests" }]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("repo-selection").textContent).toBe("/repo/main");
    });

    fireEvent.click(screen.getByRole("button", { name: /fix-tests/i }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(createSessionMock).toHaveBeenCalledTimes(1);
    });

    const args = createSessionMock.mock.calls[0];
    expect(args[0]).toBe("/repo/main");
    expect(args[1]).toBe("provider-x");
    expect(args[2]).toBe("mode-fast");
    expect(args[3]).toBe("ROUTA");
    expect(args[4]).toBe("ws-1");
    expect(args[5]).toBe("resolved-model");
    expect(args[11]).toBe("main");

    await waitFor(() => {
      expect(storePendingPromptMock).toHaveBeenCalledWith("session-1", {
        text: "Ship it",
        skillName: "fix-tests",
        skillRepoPath: "/repo/main",
      });
    });
    expect(promptSessionMock).not.toHaveBeenCalled();
    expect(onSessionCreated).toHaveBeenCalledWith(
      "session-1",
      "/fix-tests Ship it",
      { cwd: "/repo/main", branch: "main", repoName: "Main Repo" },
    );
    expect(pushMock).toHaveBeenCalledWith("/workspace/ws-1/sessions/session-1");
  });

  it("insertTextRequest is optional: omitted it reaches TiptapInput as undefined and submission is unchanged", async () => {
    const onSessionCreated = vi.fn();
    render(<HomeInput workspaceId="ws-1" onSessionCreated={onSessionCreated} />);
    await waitFor(() => expect(screen.getByTestId("repo-selection").textContent).toBe("/repo/main"));
    expect(tiptapProps.length).toBeGreaterThan(0);
    expect(tiptapProps.every((props) => props.insertTextRequest === undefined)).toBe(true);
    expect(screen.getByTestId("pending-skill").textContent).toBe("");
    expect(screen.getByTestId("disabled-state").textContent).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(createSessionMock).toHaveBeenCalledTimes(1));
    const args = createSessionMock.mock.calls[0];
    expect([args[0], args[1], args[2], args[3], args[4], args[5], args[11]]).toEqual(
      ["/repo/main", "provider-x", "mode-fast", "ROUTA", "ws-1", "resolved-model", "main"],
    );
    await waitFor(() => expect(onSessionCreated).toHaveBeenCalledWith(
      "session-1",
      "Ship it",
      { cwd: "/repo/main", branch: "main", repoName: "Main Repo" },
    ));
    expect(pushMock).toHaveBeenCalledWith("/workspace/ws-1/sessions/session-1");
  });

  it("passes insertTextRequest through to TiptapInput unchanged", async () => {
    const request = { text: "#前端开发 ", nonce: 3, mode: "append" as const };
    render(<HomeInput workspaceId="ws-1" insertTextRequest={request} />);
    await waitFor(() => expect(screen.getByTestId("repo-selection").textContent).toBe("/repo/main"));
    expect(tiptapProps.at(-1)?.insertTextRequest).toBe(request);
  });

  it("uses direct prompt dispatch when launch mode requests it", async () => {
    render(
      <HomeInput
        workspaceId="ws-1"
        launchModes={[
          {
            id: "direct",
            label: "Direct",
            description: "Direct coding",
            dispatchMode: "direct-prompt",
            sessionConfig: {
              role: "CRAFTER",
              mcpProfile: "kanban-planning",
              systemPrompt: (text: string) => `System: ${text}`,
            },
          },
        ]}
        initialLaunchModeId="direct"
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("repo-selection").textContent).toBe("/repo/main");
    });

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(createSessionMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(promptSessionMock).toHaveBeenCalledWith("session-1", "Ship it");
    });

    const args = createSessionMock.mock.calls[0];
    expect(args[3]).toBe("CRAFTER");
    expect(args[14]).toBe("kanban-planning");
    expect(args[15]).toBe("System: Ship it");
    expect(storePendingPromptMock).not.toHaveBeenCalled();
  });

  describe("model / reasoning effort picker", () => {
    const configOptions = {
      configOptions: [
        {
          id: "model",
          options: [{
            group: "local-7357",
            name: "Local 7357",
            options: [
              { value: "[\"local-7357\",\"claude-opus-5-5\"]", name: "Claude Opus 5.5" },
              { value: "[\"local-7357\",\"gpt-6.1-sol\"]", name: "GPT 6.1 Sol" },
            ],
          }],
        },
        { id: "reasoning_effort", options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }] },
      ],
    };

    function stubFetch(byProvider: Record<string, unknown>) {
      desktopAwareFetchMock.mockImplementation(async (url: string) => {
        const match = /\/api\/providers\/([^/]+)\/config-options/.exec(String(url));
        if (match) {
          const body = byProvider[decodeURIComponent(match[1])];
          return body
            ? { ok: true, json: async () => body }
            : { ok: false, status: 500, json: async () => ({ error: "probe failed" }) };
        }
        return { ok: true, json: async () => ({ specialists: [] }) };
      });
    }

    async function renderReady() {
      const view = render(<HomeInput workspaceId="ws-1" />);
      await waitFor(() => expect(screen.getByTestId("repo-selection").textContent).toBe("/repo/main"));
      return view;
    }

    it("loads options for the current provider and sends the chosen model and effort", async () => {
      stubFetch({ "provider-default": configOptions });
      getModelDefinitionByAliasMock.mockReturnValue(undefined);
      await renderReady();

      const picker = await screen.findByTestId("home-model-effort-picker");
      expect(desktopAwareFetchMock.mock.calls.some(([url]) => String(url).includes("/api/providers/provider-default/config-options"))).toBe(true);
      expect(picker.textContent).toContain("Default model");

      fireEvent.click(picker);
      fireEvent.click(screen.getByRole("option", { name: "GPT 6.1 Sol" }));
      fireEvent.click(screen.getByRole("radio", { name: "High" }));
      expect(screen.getByTestId("home-model-effort-picker-label").textContent).toBe("GPT 6.1 Sol · High");

      fireEvent.click(screen.getByRole("button", { name: "Send default toolbar" }));
      await waitFor(() => expect(createSessionMock).toHaveBeenCalledTimes(1));
      const args = createSessionMock.mock.calls[0];
      expect(args[1]).toBe("provider-default");
      expect(args[5]).toBe("gpt-6.1-sol");
      expect(args[19]).toBe("high");
      // The three positions in between keep their previous (unset) behavior.
      expect(args.slice(16, 19)).toEqual([undefined, undefined, undefined]);
    });

    it("keeps the previous model logic and omits the effort when nothing is picked", async () => {
      stubFetch({ "provider-default": configOptions });
      getModelDefinitionByAliasMock.mockReturnValue(undefined);
      await renderReady();
      await screen.findByTestId("home-model-effort-picker");

      fireEvent.click(screen.getByRole("button", { name: "Send default toolbar" }));
      await waitFor(() => expect(createSessionMock).toHaveBeenCalledTimes(1));
      const args = createSessionMock.mock.calls[0];
      expect(args[5]).toBe("provider-default-model");
      expect(args[19]).toBeUndefined();
    });

    it("refetches on provider switch and resets the pick to default", async () => {
      stubFetch({ "provider-default": configOptions, "provider-other": configOptions });
      const view = await renderReady();

      fireEvent.click(await screen.findByTestId("home-model-effort-picker"));
      fireEvent.click(screen.getByRole("option", { name: "GPT 6.1 Sol" }));
      expect(screen.getByTestId("home-model-effort-picker-label").textContent).toContain("GPT 6.1 Sol");

      acpState.selectedProvider = "provider-other";
      view.rerender(<HomeInput workspaceId="ws-1" />);

      await waitFor(() => {
        expect(desktopAwareFetchMock.mock.calls.some(([url]) => String(url).includes("/api/providers/provider-other/config-options"))).toBe(true);
      });
      await waitFor(() => {
        expect(screen.getByTestId("home-model-effort-picker-label").textContent).toBe("Default model · Default");
      });
    });

    it("renders no picker when the provider lists no model / effort options or the request fails", async () => {
      stubFetch({ "provider-default": { configOptions: [{ id: "mode", options: [] }] } });
      const view = await renderReady();
      await waitFor(() => {
        expect(desktopAwareFetchMock.mock.calls.some(([url]) => String(url).includes("/config-options"))).toBe(true);
      });
      expect(screen.queryByTestId("home-model-effort-picker")).toBeNull();

      acpState.selectedProvider = "provider-broken";
      view.rerender(<HomeInput workspaceId="ws-1" />);
      await waitFor(() => {
        expect(desktopAwareFetchMock.mock.calls.some(([url]) => String(url).includes("/api/providers/provider-broken/config-options"))).toBe(true);
      });
      expect(screen.queryByTestId("home-model-effort-picker")).toBeNull();
    });
  });

  describe("preferred default provider (card f1bc30c7 AC7 / contract C7)", () => {
    async function renderWithPreferred(status: "available" | "checking" | "unavailable") {
      acpState.providers = [
        { id: "codex", name: "Codex", status },
        { id: "opencode", name: "OpenCode", status: "available" },
      ];
      acpState.selectedProvider = "opencode";
      render(<HomeInput workspaceId="ws-1" preferredDefaultProvider="codex" />);
      await waitFor(() => expect(screen.getByTestId("repo-selection").textContent).toBe("/repo/main"));
    }

    it("falls back to use-acp's provider when the preferred one is unavailable", async () => {
      await renderWithPreferred("unavailable");

      expect(tiptapProps.at(-1)?.selectedProvider).toBe("opencode");
      fireEvent.click(screen.getByRole("button", { name: "Send default toolbar" }));
      await waitFor(() => expect(createSessionMock).toHaveBeenCalledTimes(1));
      expect(createSessionMock.mock.calls[0][1]).toBe("opencode");
    });

    it("keeps the preferred provider while its status is checking", async () => {
      await renderWithPreferred("checking");

      expect(tiptapProps.at(-1)?.selectedProvider).toBe("codex");
      fireEvent.click(screen.getByRole("button", { name: "Send default toolbar" }));
      await waitFor(() => expect(createSessionMock).toHaveBeenCalledTimes(1));
      expect(createSessionMock.mock.calls[0][1]).toBe("codex");
    });

    it("keeps the preferred provider when it is available", async () => {
      await renderWithPreferred("available");

      expect(tiptapProps.at(-1)?.selectedProvider).toBe("codex");
    });
  });
});
