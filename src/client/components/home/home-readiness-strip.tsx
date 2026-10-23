"use client";

/**
 * Readiness block restored from the pre-redesign home page (e4e5c162
 * src/app/page.tsx L463-524). Always rendered once the readiness data is
 * read, whether or not everything is ready and whether or not the inline
 * onboarding card shows: the model and codebase badges are buttons in both
 * states (open the providers settings / the repo picker), and the
 * "workspace ready" badge is static. Missing items keep the redesign's
 * explanation lines and buttons.
 */

import { useTranslation } from "@/i18n";
import { Badge, type Tone } from "@/client/components/ui/badge";
import { buttonClassName } from "@/client/components/ui/button";

function toneOf(ready: boolean): Tone {
  return ready ? "success" : "attention";
}

export function HomeReadinessStrip({
  missingModel,
  missingCodebase,
  onConfigureModel,
  onAddCodebase,
}: {
  missingModel: boolean;
  missingCodebase: boolean;
  onConfigureModel: () => void;
  onAddCodebase: () => void;
}) {
  const { t } = useTranslation();
  const home = t.home;
  const copy = t.homeRedesign;
  const modelTone = toneOf(!missingModel);
  const codebaseTone = toneOf(!missingCodebase);
  const badgeButton = "rounded focus-visible:outline-2 focus-visible:outline-accent";

  return (
    <section
      className="flex flex-col gap-2 rounded-lg border border-default bg-surface px-4 py-3"
      data-testid="home-readiness"
      aria-labelledby="home-readiness-heading"
    >
      <div className="flex flex-col gap-2 min-[801px]:flex-row min-[801px]:items-center min-[801px]:justify-between">
        <h2 id="home-readiness-heading" className="m-0 text-[13px] font-semibold text-primary">{home.readinessTitle}</h2>
        <div className="flex flex-wrap items-center gap-2" data-testid="home-readiness-badges">
          <button
            type="button"
            onClick={onConfigureModel}
            className={badgeButton}
            data-testid="home-readiness-model"
            data-tone={modelTone}
          >
            <Badge tone={modelTone}>{home.readinessModel}</Badge>
          </button>
          <button
            type="button"
            onClick={onAddCodebase}
            className={badgeButton}
            data-testid="home-readiness-codebase"
            data-tone={codebaseTone}
          >
            <Badge tone={codebaseTone}>{home.readinessCodebase}</Badge>
          </button>
          <span data-testid="home-readiness-workspace" data-tone="success">
            <Badge tone="success">{home.readinessWorkspace}</Badge>
          </span>
        </div>
      </div>
      {(missingModel || missingCodebase) && (
        <div className="flex flex-col gap-2 min-[801px]:flex-row min-[801px]:items-center min-[801px]:justify-between">
          <div className="min-w-0">
            <p className="m-0 text-[13px] font-semibold text-attention">{copy.readinessTitle}</p>
            <ul className="m-0 mt-1 list-disc pl-5 text-xs text-secondary">
              {missingModel && <li>{copy.readinessModel}</li>}
              {missingCodebase && <li>{copy.readinessCodebase}</li>}
            </ul>
          </div>
          <div className="flex flex-wrap gap-2">
            {missingModel && (
              <button type="button" onClick={onConfigureModel} className={buttonClassName("secondary", "sm")} data-testid="home-readiness-configure">
                {copy.configure}
              </button>
            )}
            {missingCodebase && (
              <button type="button" onClick={onAddCodebase} className={buttonClassName("secondary", "sm")} data-testid="home-readiness-add-codebase">
                {copy.addCodebase}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
