"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "@/i18n";

import { desktopAwareFetch } from "@/client/utils/diagnostics";
import type { RepoSlideSessionResult } from "@/core/reposlide/extract-reposlide-result";

interface RepoSlideSessionResponse {
  latestEventKind?: string;
  result?: RepoSlideSessionResult;
}

interface RepoSlideSessionPanelProps {
  workspaceId: string;
  sessionId: string;
  codebaseId?: string | null;
}

export function RepoSlideSessionPanel({
  workspaceId,
  sessionId,
  codebaseId,
}: RepoSlideSessionPanelProps) {
  const { t } = useTranslation();
  const [result, setResult] = useState<RepoSlideSessionResult>({ status: "running" });
  const [latestEventKind, setLatestEventKind] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refreshTranscript = useCallback(async () => {
    try {
      const response = await desktopAwareFetch(`/api/sessions/${sessionId}/reposlide-result`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json() as RepoSlideSessionResponse;
      setResult(payload.result ?? { status: "running" });
      setLatestEventKind(payload.latestEventKind);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void refreshTranscript();
    const timer = window.setInterval(() => {
      void refreshTranscript();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [refreshTranscript]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const previewText = useMemo(() => result.summary ?? "", [result.summary]);

  const statusLabel = result.deckPath
    ? result.downloadUrl
      ? t.repoSlide.statusReady
      : t.repoSlide.statusPathDetected
    : result.latestAssistantMessage
      ? t.repoSlide.statusWaitingPath
      : latestEventKind === "agent_message_chunk" || latestEventKind === "agent_message"
        ? t.repoSlide.statusDrafting
        : t.repoSlide.statusStarted;

  const handleCopyPath = useCallback(async () => {
    if (!result.deckPath) return;
    try {
      await navigator.clipboard.writeText(result.deckPath);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }, [result.deckPath]);

  return (
    <section className="border-b border-default bg-subtle/70 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-accent">
            {t.repoSlide.title}
          </div>
          <div className="mt-1 text-sm font-semibold text-primary">
            {statusLabel}
          </div>
          <div className="mt-1 text-xs text-secondary">
            {t.repoSlide.description}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {codebaseId && (
            <Link
              href={`/workspace/${workspaceId}/codebases/${codebaseId}/reposlide`}
              className="rounded-md border border-default px-2.5 py-1 text-xs text-primary hover:bg-hover"
            >
              {t.repoSlide.backToRepoSlide}
            </Link>
          )}
          <button
            type="button"
            onClick={() => void refreshTranscript()}
            className="rounded-md border border-default px-2.5 py-1 text-xs text-primary hover:bg-hover"
          >
            {t.repoSlide.refresh}
          </button>
        </div>
      </div>

      {loading && (
        <div className="mt-3 text-xs text-secondary">
          {t.repoSlide.loadingTranscript}
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-lg border border-danger bg-danger-subtle px-3 py-2 text-xs text-danger">
          {t.repoSlide.loadFailed} {error}
        </div>
      )}

      {!loading && !error && (
        <div className="mt-3 grid gap-3 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-xl border border-default bg-surface px-3 py-3">
            <div className="text-[11px] font-medium text-accent">
              {t.repoSlide.latestOutput}
            </div>
            {previewText ? (
              <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words text-xs text-primary">
                {previewText}
              </pre>
            ) : (
              <div className="mt-2 text-xs text-secondary">
                {t.repoSlide.noSummary}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-default bg-surface px-3 py-3">
            <div className="text-[11px] font-medium text-accent">
              {t.repoSlide.deckPath}
            </div>
            {result.deckPath ? (
              <>
                <div className="mt-2 break-all rounded-lg border border-success bg-success-subtle px-3 py-2 font-mono text-xs text-success">
                  {result.deckPath}
                </div>
                <button
                  type="button"
                  onClick={() => void handleCopyPath()}
                  className="mt-2 rounded-md border border-default px-2.5 py-1 text-xs text-primary hover:bg-hover"
                >
                  {copied ? t.repoSlide.copied : t.repoSlide.copyPath}
                </button>
                {result.downloadUrl ? (
                  <a
                    href={result.downloadUrl}
                    download
                    className="mt-2 ml-2 inline-flex rounded-md border border-default px-2.5 py-1 text-xs text-primary hover:bg-hover"
                  >
                    {t.repoSlide.downloadPptx}
                  </a>
                ) : (
                  <div className="mt-2 text-xs text-secondary">
                    {t.repoSlide.notDownloadable}
                  </div>
                )}
              </>
            ) : (
              <div className="mt-2 text-xs text-secondary">
                {t.repoSlide.noPathDetected}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
