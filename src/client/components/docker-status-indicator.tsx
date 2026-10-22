"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@/i18n";
import { desktopAwareFetch } from "@/client/utils/diagnostics";

interface DockerStatusResponse {
  available: boolean;
  daemonRunning: boolean;
  version?: string;
  error?: string;
  checkedAt: string;
  image?: string;
  imageAvailable?: boolean;
}

interface DockerStatusIndicatorProps {
  compact?: boolean;
  className?: string;
}

export function DockerStatusIndicator({ compact = false, className = "" }: DockerStatusIndicatorProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<DockerStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await desktopAwareFetch("/api/acp/docker/status", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus((await res.json()) as DockerStatusResponse);
    } catch {
      setStatus({
        available: false,
        daemonRunning: false,
        error: t.dockerStatus.checkFailed,
        checkedAt: new Date().toISOString(),
      });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const available = !!status?.available;
  const isChecking = loading && !status;
  const isRetryable = !available && !isChecking;

  const versionLabel = status?.version?.trim() || "ready";
  const readyLabel = t.dockerStatus.ready.replace("{version}", versionLabel);

  const label = isChecking
    ? t.dockerStatus.checking
    : available
      ? readyLabel
      : loading
        ? t.dockerStatus.retrying
        : t.dockerStatus.unavailable;
  const toneClass = isChecking
    ? "border-default text-secondary bg-subtle"
    : available
      ? "border-default text-success bg-success-subtle"
      : "border-default text-attention bg-attention-subtle hover:bg-hover";
  const compactToneClass = isChecking
    ? "text-secondary"
    : available
      ? "text-success"
      : "text-attention";
  const dotClass = isChecking
    ? "bg-secondary animate-pulse motion-reduce:animate-none"
    : available
      ? "bg-success"
      : loading
        ? "bg-attention animate-pulse motion-reduce:animate-none"
        : "bg-attention";
  const title = available
    ? status?.error ?? label
    : loading
      ? t.dockerStatus.refreshing
      : status?.error ?? t.dockerStatus.clickToRefresh;

  return (
    <div className="flex items-center">
      <button
        type="button"
        onClick={isRetryable ? () => void refresh() : undefined}
        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] transition-colors ${
          compact ? "border-0" : "border"
        } ${
          compact ? "bg-transparent" : toneClass
        } ${
          compact ? compactToneClass : ""
        } ${compact ? "hover:bg-transparent" : ""} ${className} ${
          isRetryable ? "cursor-pointer" : "cursor-default"
        }`}
        title={title}
        disabled={!isRetryable}
        aria-disabled={!isRetryable}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
        <span className="max-w-[140px] truncate">{label}</span>
      </button>
    </div>
  );
}
