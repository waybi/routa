/**
 * Manual real-agent check for ACP configOptions against DSH (not run in CI).
 *
 *   npx tsx scripts/debug/dsh-config-options-probe.ts [--env-file <path/to/.env.local>]
 *
 * Reads DSH_BIN from the environment or .env.local, starts AcpProcess directly
 * in an empty temp dir and checks, without ever sending session/prompt:
 *   1. session/new succeeds
 *   2. the model option offers >= 20 values and reasoning_effort exists
 *   3. set reasoning_effort=high, read back high
 *   4. set a non-default effort, switch model, the explicit effort is dropped
 *      (back to "" — or the model's default effort when it has one)
 * The DSH process and temp dir are always cleaned up.
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { AcpProcess } from "../../src/core/acp/acp-process";
import {
  MODEL_CONFIG_ID,
  REASONING_EFFORT_CONFIG_ID,
  findOption,
  flattenOptionValues,
  summarizeConfigOptions,
} from "../../src/core/acp/config-options";
import { buildConfigFromPreset } from "../../src/core/acp/process-config";

function loadDshBin(): string {
  if (process.env.DSH_BIN) return process.env.DSH_BIN;
  const flag = process.argv.indexOf("--env-file");
  const candidates = flag > -1 ? [process.argv[flag + 1]] : [path.resolve(".env.local")];
  for (const file of candidates) {
    if (!file || !existsSync(file)) continue;
    const line = readFileSync(file, "utf8").split("\n").find((l) => l.startsWith("DSH_BIN="));
    if (line) return line.slice("DSH_BIN=".length).trim().replace(/^["']|["']$/g, "");
  }
  throw new Error("DSH_BIN not found in env or .env.local (use --env-file)");
}

const results: Array<{ step: string; ok: boolean; detail: string }> = [];
function check(step: string, ok: boolean, detail: string) {
  results.push({ step, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step} — ${detail}`);
  if (!ok) throw new Error(`check failed: ${step}`);
}

async function main() {
  process.env.DSH_BIN = loadDshBin();
  const cwd = await mkdtemp(path.join(tmpdir(), "routa-dsh-config-probe-"));
  const methods: string[] = [];
  let proc: AcpProcess | undefined;
  try {
    const config = await buildConfigFromPreset("dsh", cwd);
    console.log(`DSH command: ${config.command} ${config.args.join(" ")}  cwd=${cwd}`);
    proc = new AcpProcess(config, () => {});
    const originalSend = proc.sendRequest.bind(proc);
    proc.sendRequest = ((method: string, params: Record<string, unknown>, timeoutMs?: number) => {
      methods.push(method);
      if (method === "session/prompt") throw new Error("probe must not send session/prompt");
      return originalSend(method, params, timeoutMs);
    }) as typeof proc.sendRequest;

    await proc.start();
    await proc.initialize();
    const sessionId = await proc.newSession(cwd, []);
    check("session/new", Boolean(sessionId), `sessionId=${sessionId}`);

    const initial = proc.getConfigOptions() ?? [];
    const modelValues = flattenOptionValues(findOption(initial, MODEL_CONFIG_ID)).map((v) => v.value);
    const hasEffort = Boolean(findOption(initial, REASONING_EFFORT_CONFIG_ID));
    check(
      "model options >= 20 and reasoning_effort present",
      modelValues.length >= 20 && hasEffort,
      `models=${modelValues.length}, reasoning_effort=${hasEffort}, current=${JSON.stringify(summarizeConfigOptions(initial))}`,
    );

    const afterHigh = await proc.setConfigOption(REASONING_EFFORT_CONFIG_ID, "high");
    check("set reasoning_effort=high", summarizeConfigOptions(afterHigh).reasoningEffort === "high",
      `returned=${JSON.stringify(summarizeConfigOptions(afterHigh))}`);
    const readBack = summarizeConfigOptions(proc.getConfigOptions() ?? []);
    check("read back high", readBack.reasoningEffort === "high", `cache=${JSON.stringify(readBack)}`);

    // DSH semantics (deepseek-harness packages/acp/acp/src/model-control.ts set()):
    // changing model drops the explicit effort and the new model runs at its
    // default effort — "" (provider default) when the model has no defaultEffort,
    // otherwise that default (this machine's acp profile defaults to "high").
    // So set a non-default effort first, switch model, and require the explicit
    // value to be gone (back to "" or the default seen at session/new).
    const defaultEffort = summarizeConfigOptions(initial).reasoningEffort;
    const probeEffort = flattenOptionValues(findOption(afterHigh, REASONING_EFFORT_CONFIG_ID))
      .map((v) => v.value)
      .find((v) => v !== "" && v !== defaultEffort);
    if (!probeEffort) throw new Error("no non-default reasoning effort to probe with");
    const afterProbe = await proc.setConfigOption(REASONING_EFFORT_CONFIG_ID, probeEffort);
    check(`set reasoning_effort=${probeEffort}`, summarizeConfigOptions(afterProbe).reasoningEffort === probeEffort,
      `returned=${JSON.stringify(summarizeConfigOptions(afterProbe))}`);

    const currentValue = findOption(afterProbe, MODEL_CONFIG_ID)?.currentValue;
    const otherModel = flattenOptionValues(findOption(afterProbe, MODEL_CONFIG_ID))
      .map((v) => v.value)
      .find((v) => v !== currentValue);
    if (!otherModel) throw new Error("no alternative model to switch to");
    const afterModel = await proc.setConfigOption(MODEL_CONFIG_ID, otherModel);
    const effortAfter = findOption(afterModel, REASONING_EFFORT_CONFIG_ID)?.currentValue;
    check(
      `set model drops explicit ${probeEffort} (back to "" / model default)`,
      effortAfter !== probeEffort && (effortAfter === "" || effortAfter === defaultEffort || effortAfter === undefined),
      `model=${otherModel} → ${JSON.stringify(summarizeConfigOptions(afterModel))}; session/new default=${JSON.stringify(defaultEffort)}`,
    );
  } finally {
    const pid = (proc as unknown as { process?: { pid?: number } } | undefined)?.process?.pid;
    proc?.kill();
    await new Promise((resolve) => setTimeout(resolve, 500));
    await rm(cwd, { recursive: true, force: true });
    let alive = false;
    if (pid) {
      try {
        process.kill(pid, 0);
        alive = true;
      } catch {
        alive = false;
      }
    }
    console.log(`RPC methods sent: ${methods.join(", ")}`);
    console.log(`cleanup: pid=${pid ?? "n/a"} alive=${alive}, tempDirExists=${existsSync(cwd)}`);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`RESULT ${failed === 0 ? "ok" : "failed"} (${results.length - failed}/${results.length} checks passed)`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
