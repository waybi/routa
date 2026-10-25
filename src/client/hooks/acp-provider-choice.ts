/**
 * Whether the user ever picked a provider in a composer (home / team launch
 * box). `routa.acp.selectedProvider` cannot tell: use-acp writes it on every
 * connect (first available provider) and kanban boards set it too, so a
 * separate flag records the explicit pick. Kept out of use-acp so components
 * can read it without the full ACP hook (and tests that mock use-acp still work).
 */

export const COMPOSER_PROVIDER_PICKED_KEY = "routa.acp.providerPickedInComposer";

export function hasPickedComposerProvider(): boolean {
  if (typeof window === "undefined" || !window.localStorage) return false;
  try {
    return window.localStorage.getItem(COMPOSER_PROVIDER_PICKED_KEY) === "1";
  } catch {
    return false;
  }
}

export function markComposerProviderPicked(): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(COMPOSER_PROVIDER_PICKED_KEY, "1");
  } catch {
    // Storage unavailable: the preferred default keeps applying for this page.
  }
}

/** useSyncExternalStore subscriber: another tab picking a provider. */
export function subscribeToComposerProviderPick(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/**
 * Provider the composer shows before the user picks one: the caller's
 * preferred provider while it is listed and not known to be unavailable
 * (available / checking / no status), otherwise `selectedProvider` (use-acp
 * already falls back to the first available provider there). Pure: callers
 * pass `hasPickedProvider` from `hasPickedComposerProvider()`.
 */
export function resolveComposerProviderId(args: {
  preferredDefaultProvider?: string | null;
  hasPickedProvider: boolean;
  providers?: ReadonlyArray<{ id: string; status?: string }>;
  selectedProvider: string;
}): string {
  const { preferredDefaultProvider, hasPickedProvider, providers, selectedProvider } = args;
  if (!preferredDefaultProvider || hasPickedProvider) return selectedProvider;
  const preferred = providers?.find((provider) => provider.id === preferredDefaultProvider);
  if (!preferred || preferred.status === "unavailable") return selectedProvider;
  return preferredDefaultProvider;
}
