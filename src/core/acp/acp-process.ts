import type { AcpProcessConfig, AcpSessionContext } from "@/core/acp/process-config";
import type { JsonRpcMessage, NotificationHandler, PendingRequest } from "@/core/acp/protocol-types";
import { awaitProcessReady, needsShell } from "@/core/acp/utils";
import { extractConfigOptions, type AcpConfigOption } from "@/core/acp/config-options";
import {getTerminalManager} from "@/core/acp/terminal-manager";
import type {IProcessHandle} from "@/core/platform/interfaces";
import {getServerBridge} from "@/core/platform";
import {AgentRole} from "@/core/models/agent";

/**
 * Manages a single ACP agent process and its JSON-RPC communication.
 *
 * This is the core abstraction that handles the ACP protocol over stdio.
 * It works with any ACP-compliant agent (opencode, gemini, codex-acp, etc.).
 *
 * Uses the platform bridge for process spawning and file system operations,
 * enabling support across Web (Node.js), Tauri, and Electron environments.
 */
/**
 * Authentication method info from ACP agent.
 */
export interface AcpAuthMethod {
    id: string;
    name: string;
    description: string;
}

/**
 * ACP initialization result containing agent capabilities and auth methods.
 */
export interface AcpInitResult {
    protocolVersion: number;
    agentCapabilities?: Record<string, unknown>;
    agentInfo?: {
        name: string;
        version: string;
    };
    authMethods?: AcpAuthMethod[];
}

/**
 * Custom error class for ACP errors that may include auth requirements.
 */
export class AcpError extends Error {
    code: number;
    authMethods?: AcpAuthMethod[];
    agentInfo?: { name: string; version: string };
    data?: unknown;

    constructor(
        message: string,
        code: number,
        authMethods?: AcpAuthMethod[],
        agentInfo?: { name: string; version: string },
        data?: unknown,
    ) {
        super(message);
        this.name = "AcpError";
        this.code = code;
        this.authMethods = authMethods;
        this.agentInfo = agentInfo;
        this.data = data;
    }
}

/** Default wait for initialize / session/new / session/load on a locally installed agent. */
export const DEFAULT_ACP_STARTUP_TIMEOUT_MS = 60_000;
/** npx/uvx agents may download their package on first run. */
export const NPX_ACP_STARTUP_TIMEOUT_MS = 120_000;
/** Overrides the startup wait for every agent, in milliseconds. */
export const ACP_STARTUP_TIMEOUT_ENV = "ROUTA_ACP_STARTUP_TIMEOUT_MS";

/**
 * How long to wait for an agent's startup requests. A loaded machine can take
 * well over 15s to boot dsh; a timeout there used to leave the agent running
 * while Routa recorded a failure.
 */
export function resolveAcpStartupTimeoutMs(
    config: Pick<AcpProcessConfig, "command">,
    env: Record<string, string | undefined> = process.env,
): number {
    const override = Number.parseInt(env[ACP_STARTUP_TIMEOUT_ENV] ?? "", 10);
    if (Number.isFinite(override) && override > 0) {
        return override;
    }
    const isNpxOrUvx = config.command === "npx" || config.command === "uvx";
    return isNpxOrUvx ? NPX_ACP_STARTUP_TIMEOUT_MS : DEFAULT_ACP_STARTUP_TIMEOUT_MS;
}

/** Only a spawned, still-running child (pid > 0) may receive a signal. */
function isSignalable(child: IProcessHandle): boolean {
    return typeof child.pid === "number" && child.pid > 0 && child.exitCode === null;
}

function describeSpawnFailure(displayName: string, command: string, cause: Error | null): Error {
    const code = (cause as NodeJS.ErrnoException | null)?.code;
    const reason = code === "ENOENT"
        ? `"${command}" is not installed or not in PATH (spawn ENOENT)`
        : `is "${command}" installed and in PATH?${cause ? ` (${cause.message})` : ""}`;
    return new Error(`Failed to spawn ${displayName} - ${reason}`, cause ? { cause } : undefined);
}

export class AcpProcess {
    private process: IProcessHandle | null = null;
    private buffer = "";
    private pendingRequests = new Map<number | string, PendingRequest>();
    /**
     * session/prompt requests Routa stopped waiting for. The agent keeps
     * working and answers later; that answer is the turn's real end.
     */
    private timedOutPromptIds = new Set<number | string>();
    private pendingInteractiveRequests = new Map<string, {
        requestId: number | string;
        method: string;
        params: Record<string, unknown>;
    }>();
    private requestId = 0;
    private onNotification: NotificationHandler;
    private _sessionId: string | null = null;
    private _alive = false;
    private _config: AcpProcessConfig;
    private _initResult: AcpInitResult | null = null;
    private _sessionContext: AcpSessionContext | null = null;
    private lastSyntheticTurnStopReason: string | null = null;
    private lastStderrErrorMessage: string | null = null;
    private _configOptions: AcpConfigOption[] | undefined;
    private configOptionsListener: ((options: AcpConfigOption[]) => void) | null = null;
    private forceKillTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(config: AcpProcessConfig, onNotification: NotificationHandler) {
        this._config = config;
        this.onNotification = onNotification;
    }

    get initResult(): AcpInitResult | null {
        return this._initResult;
    }

    get sessionId(): string | null {
        return this._sessionId;
    }

    get alive(): boolean {
        return this._alive && this.process !== null && this.process.exitCode === null;
    }

    /** OS pid of the agent process; undefined before spawn. Read by the orphan reaper. */
    get pid(): number | undefined {
        return this.process?.pid ?? undefined;
    }

    get config(): AcpProcessConfig {
        return this._config;
    }

    get presetId(): string | undefined {
        return this._config.preset?.id;
    }

    setSessionContext(context: AcpSessionContext): void {
        this._sessionContext = context;
    }

    /** Latest configOptions reported by the agent (session/new, session/load, updates). */
    getConfigOptions(): AcpConfigOption[] | undefined {
        return this._configOptions;
    }

    /** Observe every configOptions cache replacement (used for persistence/probe cache). */
    setConfigOptionsListener(listener: ((options: AcpConfigOption[]) => void) | null): void {
        this.configOptionsListener = listener;
    }

    private replaceConfigOptions(payload: unknown): AcpConfigOption[] | undefined {
        const options = extractConfigOptions(payload);
        if (!options) return undefined;
        this._configOptions = options;
        try {
            this.configOptionsListener?.(options);
        } catch (error) {
            console.warn(
                `[AcpProcess:${this._config.displayName}] configOptions listener failed:`,
                error,
            );
        }
        return options;
    }

    /**
     * Change one session config option via session/set_config_option.
     * The agent answers with the full option list, which replaces the cache.
     */
    async setConfigOption(configId: string, value: string): Promise<AcpConfigOption[]> {
        if (!this._sessionId) {
            throw new Error(`${this._config.displayName} has no active session`);
        }
        const result = await this.sendRequest("session/set_config_option", {
            sessionId: this._sessionId,
            configId,
            value,
        });
        return this.replaceConfigOptions(result) ?? this._configOptions ?? [];
    }

    /**
     * Spawn the ACP agent process and wait for it to be ready.
     */
    async start(): Promise<void> {
        const {command, args, cwd, env, displayName, mcpConfigs} = this._config;

        // Build final args with MCP configs if provided
        const finalArgs = [...args];

        // Add MCP server configs if provided
        // Note: Different providers may use different flags for MCP config
        // - Auggie: --mcp-config
        // - OpenCode: --mcp-config (if supported)
        // - Codex: --mcp-config (if supported)
        if (mcpConfigs && mcpConfigs.length > 0) {
            for (const mcpConfig of mcpConfigs) {
                if (mcpConfig) {
                    finalArgs.push("--mcp-config", mcpConfig);
                }
            }
        }

        console.log(
            `[AcpProcess:${displayName}] Spawning: ${command} ${finalArgs.join(" ")} (cwd: ${cwd})`
        );

        const bridge = getServerBridge();
        if (!bridge.process.isAvailable()) {
            throw new Error(
                `Process spawning is not available on this platform. ` +
                `Cannot start ${displayName}.`
            );
        }

        this.process = bridge.process.spawn(command, finalArgs, {
            stdio: ["pipe", "pipe", "pipe"],
            cwd,
            env: {
                ...process.env,
                ...env,
                NODE_NO_READLINE: "1",
                // Pin directory hints to this agent's repository; desktop hosts
                // export CALLER_DIR/PWD/OLDPWD for their own project and some
                // CLIs prefer those over the spawn cwd.
                CALLER_DIR: cwd,
                PWD: cwd,
                OLDPWD: cwd,
            },
            detached: false,
            // On Windows, batch files (.cmd/.bat) cannot be spawned directly —
            // they must be run through the shell (cmd.exe /c ...).
            shell: needsShell(command),
        });

        // Wire up stdout/stderr/exit listeners BEFORE awaiting ready.
        // Tauri's shell plugin forwards events immediately after cmd.spawn(),
        // so binding after the await would miss early output frames.
        this.process.stdout?.on("data", (chunk: Buffer) => {
            this.buffer += chunk.toString("utf-8");
            this.processBuffer();
        });

        this.process.stderr?.on("data", (chunk: Buffer) => {
            const text = chunk.toString("utf-8").trim();
            if (text) {
                this.rememberStderrError(text);
                console.error(`[AcpProcess:${displayName} stderr] ${text}`);
                // Forward stderr to frontend as process_output notification
                // This allows xterm.js to display agent process output
                this.onNotification({
                    jsonrpc: "2.0",
                    method: "session/update",
                    params: {
                        sessionId: this._sessionId ?? "pending",
                        update: {
                            sessionUpdate: "process_output",
                            source: "stderr",
                            data: text + "\n",
                            displayName,
                        },
                    },
                });
            }
        });

        this.process.on("exit", (code, signal) => {
            console.log(
                `[AcpProcess:${displayName}] Process exited: code=${code}, signal=${signal}`
            );
            // kill() clears _alive before the exit lands, so still-alive here
            // means nobody asked it to stop: a crash or an external kill.
            // Exit code is not a signal of health: dsh handles SIGTERM and
            // exits 0, and an ACP agent never quits on its own while Routa
            // still holds the session. Any exit Routa did not request counts.
            const unexpected = this._alive && this._sessionId !== null;
            this._alive = false;
            this.clearForceKillTimer();
            if (unexpected) {
                // Without this the session stayed `ready` forever and the
                // board card read "idle" for a dead agent. Routed as a
                // standard `error` update so the store flips acpStatus to
                // error and pushes a kanban:session-activity heartbeat.
                const detail = this.lastStderrErrorMessage ? `: ${this.lastStderrErrorMessage}` : "";
                try {
                    this.onNotification({
                        jsonrpc: "2.0",
                        method: "session/update",
                        params: {
                            sessionId: this._sessionId,
                            update: {
                                sessionUpdate: "error",
                                error: {
                                    code: "process_exited",
                                    message: `${displayName} process exited unexpectedly (code=${code}, signal=${signal})${detail}`,
                                },
                            },
                        },
                    });
                } catch {
                    // Exit bookkeeping below must still run.
                }
            }
            // Reject all pending requests
            for (const [id, pending] of this.pendingRequests) {
                clearTimeout(pending.timeout);
                pending.reject(new Error(`${displayName} process exited (code=${code})`));
                this.pendingRequests.delete(id);
            }
        });

        // A failed spawn (e.g. ENOENT) only surfaces as an async `error`
        // event; capture it so start() rejects with the real cause.
        let spawnError: Error | null = null;
        const spawnFailed = new Promise<void>((resolve) => {
            this.process?.on("error", (err) => {
                console.error(`[AcpProcess:${displayName}] Process error:`, err);
                this._alive = false;
                spawnError = err instanceof Error ? err : new Error(String(err));
                resolve();
            });
        });

        await awaitProcessReady(this.process);

        if (!this.process || !this.process.pid) {
            // The spawn error is emitted on the next tick; give it a moment.
            await Promise.race([spawnFailed, new Promise((resolve) => setTimeout(resolve, 100))]);
            throw describeSpawnFailure(displayName, command, spawnError);
        }

        if (!this.process.stdin || !this.process.stdout) {
            throw new Error(
                `${displayName} spawned without required stdio streams`
            );
        }

        this._alive = true;


        // Wait for process to stabilize
        await new Promise((resolve) => setTimeout(resolve, 500));

        if (!this.alive) {
            throw new Error(
                `${displayName} process died during startup ("${command}" exited with code ${this.process.exitCode})`
            );
        }

        console.log(
            `[AcpProcess:${displayName}] Process started, pid=${this.process.pid}`
        );
    }

    /**
     * Initialize the ACP protocol.
     * Stores the result including authMethods for later use.
     */
    async initialize(): Promise<AcpInitResult> {
        const result = await this.sendRequest("initialize", {
            protocolVersion: 1,
            clientInfo: {
                name: "routa-js",
                version: "0.1.0",
            },
        }) as AcpInitResult;

        // Store the init result for later use (e.g., auth error handling)
        this._initResult = result;

        console.log(
            `[AcpProcess:${this._config.displayName}] Initialized:`,
            JSON.stringify(result)
        );
        return result;
    }

    /**
     * Create a new ACP session.
     * Throws AcpError with authMethods if authentication is required.
     */
    async newSession(
        cwd?: string,
        mcpServers?: Array<Record<string, unknown>>,
    ): Promise<string> {
        try {
            const result = (await this.sendRequest("session/new", {
                cwd: cwd || this._config.cwd,
                mcpServers: mcpServers ?? [],
            })) as { sessionId: string; configOptions?: unknown };

            this._sessionId = result.sessionId;
            this.replaceConfigOptions(result);
            console.log(
                `[AcpProcess:${this._config.displayName}] Session created: ${this._sessionId}`
            );
            return this._sessionId;
        } catch (error) {
            // If authentication is required, throw AcpError with auth info
            if (error instanceof AcpError) {
                throw new AcpError(
                    error.message,
                    error.code,
                    this._initResult?.authMethods ?? error.authMethods,
                    this._initResult?.agentInfo ?? error.agentInfo,
                    error.data,
                );
            }
            if (error instanceof Error) {
                const authMatch = error.message.match(/ACP Error \[(-?\d+)\]:\s*(.+)/);
                if (authMatch) {
                    const code = parseInt(authMatch[1], 10);
                    const message = authMatch[2];

                    // Include authMethods from init result if available
                    throw new AcpError(
                        message,
                        code,
                        this._initResult?.authMethods,
                        this._initResult?.agentInfo
                    );
                }
            }
            throw error;
        }
    }

    /**
     * Load an existing ACP session.
     * Used by providers such as codex-acp that can resume persisted threads.
     */
    async loadSession(
        sessionId: string,
        cwd?: string,
        mcpServers?: Array<Record<string, unknown>>,
    ): Promise<void> {
        try {
            const result = await this.sendRequest("session/load", {
                sessionId,
                cwd: cwd || this._config.cwd,
                mcpServers: mcpServers ?? [],
            });
            this._sessionId = sessionId;
            this.replaceConfigOptions(result);
            console.log(
                `[AcpProcess:${this._config.displayName}] Session loaded: ${this._sessionId}`
            );
        } catch (error) {
            if (error instanceof AcpError) {
                throw new AcpError(
                    error.message,
                    error.code,
                    this._initResult?.authMethods ?? error.authMethods,
                    this._initResult?.agentInfo ?? error.agentInfo,
                    error.data,
                );
            }
            throw error;
        }
    }

    /**
     * Send a prompt to the current session.
     * The response comes back asynchronously; content streams via session/update notifications.
     */
    async prompt(
        sessionId: string,
        text: string
    ): Promise<{ stopReason: string }> {
        const result = (await this.sendRequest(
            "session/prompt",
            {
                sessionId,
                prompt: [{type: "text", text}],
            },
            300000 // 5 min timeout for prompts
        )) as { stopReason: string };
        return result;
    }

    /**
     * Cancel the current prompt.
     */
    async cancel(sessionId: string): Promise<void> {
        // session/cancel is a notification (no response expected)
        this.writeMessage({
            jsonrpc: "2.0",
            method: "session/cancel",
            params: {sessionId},
        });
    }

    /**
     * Send a generic JSON-RPC request and wait for response.
     */
    async sendRequest(
        method: string,
        params: Record<string, unknown>,
        timeoutMs?: number
    ): Promise<unknown> {
        if (!this.alive) {
            throw new Error(`${this._config.displayName} process is not alive`);
        }

        return new Promise((resolve, reject) => {
            const id = ++this.requestId;

            // Determine timeout based on method and distribution type
            const isInitRequest = method === "initialize" || method === "session/new" || method === "session/load";
            const isPromptRequest = method === "session/prompt";

            let defaultTimeout: number;
            if (isInitRequest) {
                defaultTimeout = resolveAcpStartupTimeoutMs(this._config);
            } else if (isPromptRequest) {
                // session/prompt can take a long time for complex tasks
                // Match Rust implementation: 5 minutes for prompt requests
                defaultTimeout = 300000; // 5 min
            } else {
                defaultTimeout = 30000; // 30s for other requests
            }

            const timeout = setTimeout(() => {
                this.pendingRequests.delete(id);
                if (isPromptRequest) {
                    this.timedOutPromptIds.add(id);
                }
                reject(new Error(
                    `Timeout waiting for ${method} (id=${id}) from ${this._config.displayName} ("${this._config.command}")`
                ));
            }, timeoutMs ?? defaultTimeout);

            this.pendingRequests.set(id, {resolve, reject, timeout});

            this.writeMessage({
                jsonrpc: "2.0",
                id,
                method,
                params,
            });
        });
    }

    /**
     * Kill the agent process.
     */
    kill(): void {
        // Cleared before signalling so the exit handler (which may fire
        // synchronously) sees an intentional stop, not a crash.
        this._alive = false;
        // Never signal a child without a pid: Node keeps the handle of a
        // failed spawn (ENOENT) with pid 0, and kill() then signals the whole
        // process group — the Routa server itself.
        if (this.process && isSignalable(this.process)) {
            console.log(
                `[AcpProcess:${this._config.displayName}] Killing process pid=${this.process.pid}`
            );
            this.process.kill("SIGTERM");

            // Force kill after 5 seconds if still alive
            this.clearForceKillTimer();
            this.forceKillTimer = setTimeout(() => {
                this.forceKillTimer = null;
                if (this.process && isSignalable(this.process)) {
                    this.process.kill("SIGKILL");
                }
            }, 5000);
        }
        this._alive = false;
        this.pendingInteractiveRequests.clear();
    }

    private clearForceKillTimer(): void {
        if (this.forceKillTimer) {
            clearTimeout(this.forceKillTimer);
            this.forceKillTimer = null;
        }
    }

    respondToUserInput(toolCallId: string, response: Record<string, unknown>): boolean {
        const pending = this.pendingInteractiveRequests.get(toolCallId);
        if (!pending) {
            return false;
        }

        this.pendingInteractiveRequests.delete(toolCallId);

        let result: Record<string, unknown>;
        let notificationRawInput: Record<string, unknown> = response;
        if (pending.method === "session/request_permission") {
            const explicitOptionId = typeof response.optionId === "string" && response.optionId.trim().length > 0
                ? response.optionId.trim()
                : undefined;
            const decision = typeof response.decision === "string" ? response.decision : "approve";
            const scope = response.scope === "session" ? "session" : "turn";
            result = explicitOptionId
                ? {
                    outcome: {
                        outcome: "selected",
                        optionId: explicitOptionId,
                    },
                }
                : this.buildPermissionResponseResult(pending.params, decision, scope);
            const selectedOptionId = explicitOptionId ?? this.extractSelectedPermissionOptionId(result);
            notificationRawInput = {
                ...pending.params,
                decision,
                scope,
                outcome: typeof selectedOptionId === "string" ? "selected" : "cancelled",
                ...(selectedOptionId ? { optionId: selectedOptionId } : {}),
            };
        } else {
            result = response;
        }

        console.log(
            `[AcpProcess:${this._config.displayName}] Responding to interactive agent request ${pending.method} (id=${String(pending.requestId)}): ${JSON.stringify(result)}`
        );
        this.writeMessage({
            jsonrpc: "2.0",
            id: pending.requestId,
            result,
        });

        this.onNotification({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
                sessionId: this._sessionId ?? "pending",
                update: {
                    sessionUpdate: "tool_call_update",
                    toolCallId,
                    title: pending.method === "session/request_permission" ? "RequestPermissions" : "UserInputResponse",
                    status: "completed",
                    rawInput: notificationRawInput,
                    rawOutput: pending.method === "session/request_permission" ? result : undefined,
                },
            },
        });

        return true;
    }

    // ─── Private ────────────────────────────────────────────────────────────

    private processBuffer(): void {
        const lines = this.buffer.split("\n");
        // Keep the last incomplete line in the buffer
        this.buffer = lines[lines.length - 1];

        for (let i = 0; i < lines.length - 1; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            try {
                const msg = JSON.parse(line) as JsonRpcMessage;
                this.handleMessage(msg);
            } catch {
                // Try to find JSON objects in the line (some agents concatenate)
                this.tryParseEmbeddedJson(line);
            }
        }
    }

    private tryParseEmbeddedJson(line: string): void {
        // Try to find JSON objects by matching braces
        let depth = 0;
        let start = -1;

        for (let i = 0; i < line.length; i++) {
            if (line[i] === "{") {
                if (depth === 0) start = i;
                depth++;
            } else if (line[i] === "}") {
                depth--;
                if (depth === 0 && start >= 0) {
                    try {
                        const msg = JSON.parse(line.slice(start, i + 1)) as JsonRpcMessage;
                        this.handleMessage(msg);
                    } catch {
                        // Ignore parse errors for embedded JSON
                    }
                    start = -1;
                }
            }
        }
    }

    private handleMessage(msg: JsonRpcMessage): void {
        // Response to a pending request (has id, has result or error)
        if (
            msg.id !== undefined &&
            (msg.result !== undefined || msg.error !== undefined)
        ) {
            const pending = this.pendingRequests.get(msg.id);
            if (pending) {
                clearTimeout(pending.timeout);
                this.pendingRequests.delete(msg.id);
                if (msg.error) {
                    pending.reject(
                        new AcpError(
                            msg.error.message,
                            msg.error.code,
                            undefined,
                            undefined,
                            msg.error.data,
                        )
                    );
                } else {
                    pending.resolve(msg.result);
                }
                return;
            }

            if (this.handleTimedOutPromptResponse(msg)) {
                return;
            }

            if (this.handleLateTurnCompleteResult(msg.result)) {
                return;
            }
        }

        // Agent→Client requests (has id and method, expects response)
        if (msg.id !== undefined && msg.method) {
            this.handleAgentRequest(msg);
            return;
        }

        // Notification (no id, has method) - e.g. session/update
        if (msg.method) {
            const enrichedMsg = this.enrichAcpStatusError(msg);
            const updateType = (enrichedMsg.params as Record<string, unknown>)?.update;
            const sessionUpdate = updateType
                ? (updateType as Record<string, unknown>)?.sessionUpdate
                : (enrichedMsg.params as Record<string, unknown>)?.sessionUpdate;
            console.log(
                `[AcpProcess:${this._config.displayName}] Notification: ${enrichedMsg.method} (${sessionUpdate ?? "unknown"})`
            );
            if (sessionUpdate === "config_option_update") {
                this.replaceConfigOptions(updateType ?? enrichedMsg.params);
            }
            this.onNotification(enrichedMsg);
            return;
        }

        console.warn(
            `[AcpProcess:${this._config.displayName}] Unhandled message:`,
            JSON.stringify(msg)
        );
    }

    /**
     * The answer to a session/prompt Routa gave up waiting for. Before this,
     * an error answer (for example a rate-limit turn failure) was logged as
     * "Unhandled message" and the lane stayed running forever. Both outcomes
     * now reach the session store as the turn's end.
     */
    private handleTimedOutPromptResponse(msg: JsonRpcMessage): boolean {
        if (msg.id === undefined || !this.timedOutPromptIds.has(msg.id)) {
            return false;
        }
        this.timedOutPromptIds.delete(msg.id);
        const sessionId = this._sessionId ?? "pending";

        if (msg.error) {
            const message = `${this._config.displayName} turn ended with an error after Routa stopped waiting for it: ${msg.error.message}`;
            console.warn(`[AcpProcess:${this._config.displayName}] ${message}`);
            this.onNotification({
                jsonrpc: "2.0",
                method: "session/update",
                params: {
                    sessionId,
                    update: {
                        sessionUpdate: "error",
                        error: {
                            code: "prompt_failed_after_timeout",
                            message,
                        },
                    },
                },
            });
            return true;
        }

        const payload = msg.result && typeof msg.result === "object"
            ? msg.result as Record<string, unknown>
            : {};
        const stopReason = typeof payload.stopReason === "string" ? payload.stopReason : "end_turn";
        console.warn(
            `[AcpProcess:${this._config.displayName}] Turn ended after Routa stopped waiting for it (stopReason=${stopReason})`
        );
        this.lastSyntheticTurnStopReason = stopReason;
        this.onNotification({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
                sessionId,
                update: {
                    sessionUpdate: "turn_complete",
                    stopReason,
                },
            },
        });
        return true;
    }

    private handleLateTurnCompleteResult(result: unknown): boolean {
        if (!result || typeof result !== "object") {
            return false;
        }

        const payload = result as Record<string, unknown>;
        const stopReason = typeof payload.stopReason === "string"
            ? payload.stopReason
            : undefined;
        if (!stopReason) {
            return false;
        }

        if (this.lastSyntheticTurnStopReason === stopReason) {
            return true;
        }

        this.lastSyntheticTurnStopReason = stopReason;
        this.onNotification({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
                sessionId: this._sessionId ?? "pending",
                update: {
                    sessionUpdate: "turn_complete",
                    stopReason,
                },
            },
        });
        return true;
    }

    private rememberStderrError(text: string): void {
        const firstBrace = text.indexOf("{");
        const lastBrace = text.lastIndexOf("}");
        if (firstBrace < 0 || lastBrace <= firstBrace) {
            return;
        }

        try {
            const payload = JSON.parse(text.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
            const errorRecord = payload.error && typeof payload.error === "object"
                ? payload.error as Record<string, unknown>
                : undefined;
            const message = typeof errorRecord?.message === "string"
                ? errorRecord.message
                : typeof payload.message === "string"
                    ? payload.message
                    : undefined;
            if (message?.trim()) {
                this.lastStderrErrorMessage = message.trim();
            }
        } catch {
            // Stderr is not structured for many providers.
        }
    }

    private enrichAcpStatusError(msg: JsonRpcMessage): JsonRpcMessage {
        const params = msg.params && typeof msg.params === "object"
            ? msg.params as Record<string, unknown>
            : undefined;
        const update = params?.update && typeof params.update === "object"
            ? params.update as Record<string, unknown>
            : undefined;

        if (
            update?.sessionUpdate !== "acp_status" ||
            update.status !== "error" ||
            update.error !== "Internal error" ||
            !this.lastStderrErrorMessage
        ) {
            return msg;
        }

        const enrichedError = this.lastStderrErrorMessage;
        this.lastStderrErrorMessage = null;

        return {
            ...msg,
            params: {
                ...params,
                update: {
                    ...update,
                    error: enrichedError,
                },
            },
        };
    }

    /**
     * Handle requests FROM the agent TO the client (fs, terminal, permissions).
     * We auto-respond to keep the agent running.
     */
    private handleAgentRequest(msg: JsonRpcMessage): void {
        const {method, id, params} = msg;

        console.log(
            `[AcpProcess:${this._config.displayName}] Agent request: ${method} (id=${id})`
        );

        switch (method) {
            case "session/request_permission": {
                const toolCallId = `request-permission-${String(id)}`;
                const rawInput = (params && typeof params === "object")
                    ? params as Record<string, unknown>
                    : {};
                if (this.shouldAutoApprovePermissionRequest(rawInput)) {
                    const result = this.buildPermissionApprovalResult(rawInput);
                    console.log(
                        `[AcpProcess:${this._config.displayName}] Auto-responding to agent request ${method} (id=${String(id)}): ${JSON.stringify(result)}`
                    );
                    this.writeMessage({
                        jsonrpc: "2.0",
                        id,
                        result,
                    });
                    this.onNotification({
                        jsonrpc: "2.0",
                        method: "session/update",
                        params: {
                            sessionId: this._sessionId ?? "pending",
                            update: {
                                sessionUpdate: "tool_call_update",
                                title: "RequestPermissions",
                                toolCallId,
                                kind: "request-permissions",
                                status: "completed",
                                rawInput: result,
                            },
                        },
                    });
                    break;
                }
                this.pendingInteractiveRequests.set(toolCallId, {
                    requestId: id!,
                    method,
                    params: rawInput,
                });

                this.onNotification({
                    jsonrpc: "2.0",
                    method: "session/update",
                    params: {
                        sessionId: this._sessionId ?? "pending",
                        update: {
                            sessionUpdate: "tool_call",
                            title: "RequestPermissions",
                            toolCallId,
                            kind: "request-permissions",
                            rawInput,
                            status: "waiting",
                        },
                    },
                });
                break;
            }

            case "fs/read_text_file": {
                const filePath = (params as { path: string })?.path;
                if (filePath) {
                    const fsBridge = getServerBridge().fs;
                    fsBridge.readTextFile(filePath).then((content) => {
                        console.log(
                            `[AcpProcess:${this._config.displayName}] Responding to agent request ${method} (id=${String(id)}): ${JSON.stringify({content})}`
                        );
                        this.writeMessage({
                            jsonrpc: "2.0",
                            id,
                            result: {content},
                        });
                    }).catch((err) => {
                        this.writeMessage({
                            jsonrpc: "2.0",
                            id,
                            error: {
                                code: -32000,
                                message: `Failed to read file: ${(err as Error).message}`,
                            },
                        });
                    });
                }
                break;
            }

            case "fs/write_text_file": {
                const {path: writePath, content} = (params as {
                    path: string;
                    content: string;
                }) ?? {};
                if (writePath && content !== undefined) {
                    const fsBridge = getServerBridge().fs;
                    fsBridge.writeTextFile(writePath, content).then(() => {
                        console.log(
                            `[AcpProcess:${this._config.displayName}] Responding to agent request ${method} (id=${String(id)}): {}`
                        );
                        this.writeMessage({
                            jsonrpc: "2.0",
                            id,
                            result: {},
                        });
                    }).catch((err) => {
                        this.writeMessage({
                            jsonrpc: "2.0",
                            id,
                            error: {
                                code: -32000,
                                message: `Failed to write file: ${(err as Error).message}`,
                            },
                        });
                    });
                }
                break;
            }

            case "terminal/create": {
                const terminalManager = getTerminalManager();
                const termParams = (params ?? {}) as Record<string, unknown>;
                const result = terminalManager.create(
                    termParams,
                    this._sessionId ?? "unknown",
                    (notification) => {
                        // Forward terminal notifications through the ACP notification channel
                        this.onNotification(notification as unknown as JsonRpcMessage);
                    }
                );
                console.log(
                    `[AcpProcess:${this._config.displayName}] Responding to agent request ${method} (id=${String(id)}): ${JSON.stringify(result)}`
                );
                this.writeMessage({
                    jsonrpc: "2.0",
                    id,
                    result,
                });
                break;
            }

            case "terminal/output": {
                const terminalManager = getTerminalManager();
                const termId = (params as { terminalId?: string })?.terminalId;
                const output = termId
                    ? terminalManager.getOutput(termId)
                    : { output: "", truncated: false };
                console.log(
                    `[AcpProcess:${this._config.displayName}] Responding to agent request ${method} (id=${String(id)}): ${JSON.stringify(output)}`
                );
                this.writeMessage({
                    jsonrpc: "2.0",
                    id,
                    result: output,
                });
                break;
            }

            case "terminal/wait_for_exit": {
                const terminalManager = getTerminalManager();
                const termId = (params as { terminalId?: string })?.terminalId;
                if (termId) {
                    terminalManager.waitForExit(termId).then((result) => {
                        console.log(
                            `[AcpProcess:${this._config.displayName}] Responding to agent request ${method} (id=${String(id)}): ${JSON.stringify(result)}`
                        );
                        this.writeMessage({
                            jsonrpc: "2.0",
                            id,
                            result,
                        });
                    });
                } else {
                    console.log(
                        `[AcpProcess:${this._config.displayName}] Responding to agent request ${method} (id=${String(id)}): ${JSON.stringify({ exitCode: null, signal: null })}`
                    );
                    this.writeMessage({
                        jsonrpc: "2.0",
                        id,
                        result: { exitCode: null, signal: null },
                    });
                }
                break;
            }

            case "terminal/kill": {
                const terminalManager = getTerminalManager();
                const termId = (params as { terminalId?: string })?.terminalId;
                if (termId) {
                    terminalManager.kill(termId);
                }
                console.log(
                    `[AcpProcess:${this._config.displayName}] Responding to agent request ${method} (id=${String(id)}): {}`
                );
                this.writeMessage({
                    jsonrpc: "2.0",
                    id,
                    result: {},
                });
                break;
            }

            case "terminal/release": {
                const terminalManager = getTerminalManager();
                const termId = (params as { terminalId?: string })?.terminalId;
                if (termId) {
                    terminalManager.release(termId);
                }
                console.log(
                    `[AcpProcess:${this._config.displayName}] Responding to agent request ${method} (id=${String(id)}): {}`
                );
                this.writeMessage({
                    jsonrpc: "2.0",
                    id,
                    result: {},
                });
                break;
            }

            default: {
                console.warn(
                    `[AcpProcess:${this._config.displayName}] Unknown agent request: ${method}`
                );
                this.writeMessage({
                    jsonrpc: "2.0",
                    id,
                    error: {
                        code: -32601,
                        message: `Method not supported: ${method}`,
                    },
                });
            }
        }
    }

    private shouldAutoApprovePermissionRequest(params: Record<string, unknown>): boolean {
        const provider = (this._sessionContext?.provider ?? this.presetId ?? "").toLowerCase();
        const isCodex = provider === "codex" || provider === "codex-acp";
        if (isCodex) return typeof params === "object" && params !== null;

        if (!this._sessionContext?.autoApprovePermissions) return false;

        return typeof params === "object" && params !== null;
    }

    private buildPermissionApprovalResult(params: Record<string, unknown>): Record<string, unknown> {
        const scope = this.getDefaultPermissionScope();
        return this.buildPermissionResponseResult(params, "approve", scope);
    }

    private getDefaultPermissionScope(): "session" | "turn" {
        const role = (this._sessionContext?.role ?? "").toUpperCase();
        return role === AgentRole.ROUTA ? "session" : "turn";
    }

    private resolvePermissionOptionId(
        params: Record<string, unknown>,
        decision: string,
        scope: "session" | "turn",
    ): string | undefined {
        const options = Array.isArray(params.options)
            ? params.options.filter((option): option is Record<string, unknown> => typeof option === "object" && option !== null)
            : [];
        if (options.length === 0) {
            return undefined;
        }

        const normalizedOptions = options.map((option) => ({
            optionId: typeof option.optionId === "string" ? option.optionId : undefined,
            kind: typeof option.kind === "string" ? option.kind : undefined,
        })).flatMap((option) => (
            typeof option.optionId === "string"
                ? [{ optionId: option.optionId, kind: option.kind }]
                : []
        ));

        if (decision === "deny") {
            return this.findPermissionOptionId(normalizedOptions, [
                "abort",
                "denied",
                "decline",
                "cancel",
                "rejected",
                "reject",
            ], [
                "reject_once",
                "reject_always",
            ]);
        }

        if (scope === "session") {
            return this.findPermissionOptionId(normalizedOptions, [
                "approved-for-session",
                "approved-always",
                "approved-execpolicy-amendment",
                "approved",
            ], [
                "allow_always",
                "allow_once",
            ]);
        }

        return this.findPermissionOptionId(normalizedOptions, [
            "approved",
            "approved-once",
            "approved-for-session",
            "approved-always",
            "approved-execpolicy-amendment",
        ], [
            "allow_once",
            "allow_always",
        ]);
    }

    private buildPermissionResponseResult(
        params: Record<string, unknown>,
        decision: string,
        scope: "session" | "turn",
    ): Record<string, unknown> {
        const optionId = this.resolvePermissionOptionId(params, decision, scope)
            ?? this.getFallbackPermissionOptionId(decision, scope);

        if (optionId) {
            return {
                outcome: {
                    outcome: "selected",
                    optionId,
                },
            };
        }

        return {
            outcome: {
                outcome: "cancelled",
            },
        };
    }

    private getFallbackPermissionOptionId(
        decision: string,
        scope: "session" | "turn",
    ): string | undefined {
        if (decision === "deny") {
            return "abort";
        }
        return scope === "session" ? "approved-for-session" : "approved";
    }

    private extractSelectedPermissionOptionId(result: Record<string, unknown>): string | undefined {
        const outcome = typeof result.outcome === "object" && result.outcome !== null
            ? result.outcome as Record<string, unknown>
            : undefined;
        return typeof outcome?.optionId === "string" ? outcome.optionId : undefined;
    }

    private findPermissionOptionId(
        options: Array<{ optionId: string; kind?: string }>,
        preferredIds: string[],
        preferredKinds: string[],
    ): string | undefined {
        for (const optionId of preferredIds) {
            const match = options.find((option) => option.optionId === optionId);
            if (match) return match.optionId;
        }

        for (const kind of preferredKinds) {
            const match = options.find((option) => option.kind === kind);
            if (match) return match.optionId;
        }

        return options[0]?.optionId;
    }

    private writeMessage(msg: Record<string, unknown>): void {
        if (!this.process?.stdin || !this.process.stdin.writable) {
            console.error(
                `[AcpProcess:${this._config.displayName}] Cannot write - stdin not writable`
            );
            return;
        }

        const data = JSON.stringify(msg) + "\n";
        this.process.stdin.write(data);
    }
}
