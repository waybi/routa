/**
 * Settings / Webhooks - /settings/webhooks
 * Settings page for configuring GitHub webhook ingestion and inspecting the webhook endpoint used by Routa.
 */
"use client";

import { GitHubWebhookPanel } from "@/client/components/github-webhook-panel";
import { SettingsRouteShell } from "@/client/components/settings-route-shell";
import { useTranslation } from "@/i18n";

export default function WebhookSettingsPage() {
  const { t } = useTranslation();
  const copy = t.settingsRedesign.pages.webhooks;

  return (
    <SettingsRouteShell
      activeSettingsItem="webhooks"
      title={copy.title}
      description={copy.description}
      actions={(
        <span className="inline-flex items-center gap-1.5 rounded-md border border-default bg-subtle px-2 py-1 text-[11px] text-secondary">
          {t.settings.webhookUrl}
          <code className="font-mono text-primary">/api/webhooks/github</code>
        </span>
      )}
      contentClassName="min-h-0 flex-1 overflow-hidden px-6 py-5 max-[800px]:px-4"
    >
      <div className="h-full overflow-hidden rounded-lg border border-default bg-surface">
        <GitHubWebhookPanel />
      </div>
    </SettingsRouteShell>
  );
}
