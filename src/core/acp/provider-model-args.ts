export function buildProviderModelArgs(provider: string, model: string | undefined): string[] | undefined {
  const trimmedModel = model?.trim();
  if (!trimmedModel) {
    return undefined;
  }

  // DSH does not accept -m; its startup model comes from DSH_ACP_MODEL and
  // in-session changes go through session/set_config_option.
  if (provider === "dsh") {
    return undefined;
  }

  if (provider === "codex" || provider === "codex-acp") {
    return ["-c", `model=${JSON.stringify(trimmedModel)}`];
  }

  return ["-m", trimmedModel];
}
