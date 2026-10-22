"use client";

import { Component, Suspense, useSyncExternalStore, type ReactNode } from "react";

import { CanvasViewer } from "@/client/components/canvas-viewer";
import { DesktopAppShell } from "@/client/components/desktop-app-shell";
import { SettingsPageHeader } from "@/client/components/settings-page-header";
import { ErrorState } from "@/client/components/ui/states";
import { useTranslation } from "@/i18n";

function subscribe() {
  return () => {};
}

/**
 * Keeps a failed canvas load (missing ID, network error, bad source) inside
 * the app shell. Without it the error thrown by the shared CanvasViewer
 * reaches the Next.js root and the whole page, shell included, is replaced.
 */
class CanvasErrorBoundary extends Component<
  { fallback: (message: string) => ReactNode; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return this.props.fallback(this.state.error.message);
    }
    return this.props.children;
  }
}

export function CanvasViewerClient({ canvasId }: { canvasId: string }) {
  const { t } = useTranslation();
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const copy = t.pagesRedesign.canvasPage;

  return (
    <DesktopAppShell workspaceId={null}>
      <div className="flex h-full min-h-0 flex-col bg-canvas text-primary" data-testid="canvas-page">
        <SettingsPageHeader
          title={t.pagesRedesign.headers.canvas.title}
          description={t.pagesRedesign.headers.canvas.description}
        />
        <div className="min-h-0 flex-1 overflow-auto">
          {/* CanvasViewer suspends on fetch and uses relative API paths. Delay rendering
              until the browser has mounted so Node/SSR never tries to resolve `/api/...`. */}
          {mounted ? (
            <CanvasErrorBoundary
              key={canvasId}
              fallback={(message) => (
                <div className="p-6" data-testid="canvas-load-error">
                  <ErrorState title={copy.loadFailedTitle} message={`${copy.loadFailedDescription} (${message})`} />
                </div>
              )}
            >
              <Suspense fallback={null}>
                <CanvasViewer canvasId={canvasId} />
              </Suspense>
            </CanvasErrorBoundary>
          ) : null}
        </div>
      </div>
    </DesktopAppShell>
  );
}
