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
