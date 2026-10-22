"use client";

import { RefreshCw, Sparkles } from "lucide-react";

import { Button } from "@/client/components/button";
import { SettingsPageHeader } from "@/client/components/settings-page-header";
import { useTranslation } from "@/i18n";

/**
 * Feature explorer page header (design-spec §2): 21px title, one line of
 * description, and the two page-level actions pinned to the right. The
 * actions used to sit next to the repo picker in the narrow left column,
 * where they overlapped it at 1440px.
 */
export function FeatureExplorerPageHeader({
  onGenerate,
  onRefreshFrictionProfiles,
  refreshDisabled,
  isRefreshingFrictionProfiles,
}: {
  onGenerate: () => void;
  onRefreshFrictionProfiles: () => void;
  refreshDisabled: boolean;
  isRefreshingFrictionProfiles: boolean;
}) {
  const { t } = useTranslation();
  const header = t.pagesRedesign.headers.featureExplorer;
  return (
    <SettingsPageHeader
      title={header.title}
      description={header.description}
      actions={(
        <>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={onRefreshFrictionProfiles}
            disabled={refreshDisabled}
            data-testid="refresh-friction-profiles-button"
            title={t.featureExplorer.refreshFrictionProfiles}
            aria-label={t.featureExplorer.refreshFrictionProfiles}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshingFrictionProfiles ? "animate-spin" : ""}`} />
            <span>
              {isRefreshingFrictionProfiles
                ? t.featureExplorer.refreshingFrictionProfiles
                : t.featureExplorer.refreshFrictionProfiles}
            </span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="primary"
            onClick={onGenerate}
            data-testid="generate-feature-tree-button"
            title={t.featureExplorer.generateFeatureTree}
            aria-label={t.featureExplorer.generateFeatureTree}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>{t.featureExplorer.generateFeatureTree}</span>
          </Button>
        </>
      )}
    />
  );
}
