"use client";

import { Suspense, useSyncExternalStore } from "react";

import { CanvasViewer } from "@/client/components/canvas-viewer";
import { DesktopAppShell } from "@/client/components/desktop-app-shell";
import { SettingsPageHeader } from "@/client/components/settings-page-header";
import { useTranslation } from "@/i18n";

function subscribe() {
  return () => {};
}

export function CanvasViewerClient({ canvasId }: { canvasId: string }) {
  const { t } = useTranslation();
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);

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
            <Suspense fallback={null}>
              <CanvasViewer canvasId={canvasId} />
            </Suspense>
          ) : null}
        </div>
      </div>
    </DesktopAppShell>
  );
}
