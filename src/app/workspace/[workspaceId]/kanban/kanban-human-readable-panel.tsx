"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { desktopAwareFetch, toErrorMessage } from "@/client/utils/diagnostics";
import {
  extractTaskHumanSummaryFacts,
  type TaskHumanSummaryLanguage,
  type TaskHumanSummaryRecord,
} from "@/core/kanban/task-human-summary";
import { useTranslation } from "@/i18n";
import type { KanbanColumnInfo, TaskInfo } from "../types";
import type { KanbanSpecialistLanguage } from "./kanban-specialist-language";

/**
 * "人话版" tab body.
 *
 * Layer 1 (instant, deterministic): facts parsed from the description on the client.
 * Layer 2 (on demand, cached): model summary fetched from /api/tasks/:id/human-summary.
 *   - mount → GET (cache only, never generates)
 *   - no cached record → POST once automatically
 *   - cached but hash differs → stale badge + regenerate button (no auto call)
 */

interface HumanSummaryResponse {
  taskId: string;
  descriptionHash: string;
  language: TaskHumanSummaryLanguage;
  record: TaskHumanSummaryRecord | null;
  stale: boolean;
  cached: boolean;
}

type SummaryPhase = "loading" | "idle" | "generating" | "error";

function toSummaryLanguage(language: KanbanSpecialistLanguage): TaskHumanSummaryLanguage {
  return language === "zh-CN" ? "zh-CN" : "en";
}

function formatTimestamp(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleString();
}

function shortHash(hash: string): string {
  return hash.slice(0, 8);
}

export function KanbanHumanReadablePanel({
  task,
  boardColumns,
  specialistLanguage,
  compact = false,
  onOpenDescription,
}: {
  task: TaskInfo;
  boardColumns?: KanbanColumnInfo[];
  specialistLanguage: KanbanSpecialistLanguage;
  compact?: boolean;
  onOpenDescription?: () => void;
}) {
  const { t } = useTranslation();
  const language = toSummaryLanguage(specialistLanguage);
  const facts = useMemo(
    () => extractTaskHumanSummaryFacts({ title: task.title, objective: task.objective, columnId: task.columnId }),
    [task.title, task.objective, task.columnId],
  );
  const laneName = boardColumns?.find((column) => column.id === facts.laneId)?.name ?? facts.laneId;

  const [phase, setPhase] = useState<SummaryPhase>("loading");
  const [response, setResponse] = useState<HumanSummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoGenerateAttempted = useRef<string | null>(null);

  const endpoint = `/api/tasks/${encodeURIComponent(task.id)}/human-summary`;

  const generate = useCallback(async (force: boolean) => {
    setPhase("generating");
    setError(null);
    try {
      const res = await desktopAwareFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language, force }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof payload?.error === "string" ? payload.error : `HTTP ${res.status}`);
      }
      setResponse(payload as HumanSummaryResponse);
      setPhase("idle");
    } catch (err) {
      setError(toErrorMessage(err));
      setPhase("error");
    }
  }, [endpoint, language]);

  useEffect(() => {
    let cancelled = false;
    setPhase("loading");
    setError(null);
    (async () => {
      try {
        const res = await desktopAwareFetch(`${endpoint}?language=${encodeURIComponent(language)}`);
        const payload = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          throw new Error(typeof payload?.error === "string" ? payload.error : `HTTP ${res.status}`);
        }
        const data = payload as HumanSummaryResponse;
        setResponse(data);
        const autoKey = `${task.id}:${language}`;
        if (!data.record && autoGenerateAttempted.current !== autoKey) {
          autoGenerateAttempted.current = autoKey;
          await generate(false);
          return;
        }
        setPhase("idle");
      } catch (err) {
        if (cancelled) return;
        setError(toErrorMessage(err));
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [endpoint, language, task.id, generate]);

  const record = response?.record ?? null;
  const stale = response?.stale ?? false;
  const generatedAt = formatTimestamp(record?.generatedAt);
  const padding = compact ? "px-3 py-2.5" : "px-4 py-3";

  return (
    <div className="space-y-3">
      <section className="space-y-2" data-testid="human-readable-facts">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
            {t.kanbanDetail.humanReadableFacts}
          </div>
          {onOpenDescription ? (
            <button
              type="button"
              onClick={onOpenDescription}
              className="rounded-md border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {t.kanbanDetail.humanReadableOpenDescription}
            </button>
          ) : null}
        </div>
        {!compact ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">{t.kanbanDetail.humanReadableFactsHint}</p>
        ) : null}

        <div className={`border-l-2 ${padding} ${
          facts.blockReason
            ? "border-l-amber-400/80 dark:border-l-amber-500/70"
            : "border-l-emerald-400/80 dark:border-l-emerald-500/70"
        }`}>
          <div className="text-base font-semibold text-slate-900 dark:text-slate-100">{facts.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <span>{t.kanbanDetail.humanReadableCurrentLane}: {laneName}</span>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              facts.blockReason
                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200"
                : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200"
            }`}>
              {facts.blockReason ? t.kanbanDetail.humanReadableBlocked : t.kanbanDetail.humanReadableNotBlocked}
            </span>
          </div>
          {facts.problemStatement ? (
            <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-200">{facts.problemStatement}</p>
          ) : null}
          {facts.blockReason ? (
            <p className="mt-2 text-sm leading-6 text-amber-800 dark:text-amber-200">{facts.blockReason}</p>
          ) : null}
        </div>

        {!facts.hasCanonicalYaml ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">{t.kanbanDetail.humanReadableNoYaml}</p>
        ) : null}

        {facts.acceptanceCriteria.length > 0 ? (
          <table className="w-full border-collapse text-sm" data-testid="human-readable-ac-table">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                <th className="w-14 py-1 pr-2">AC</th>
                <th className="py-1 pr-2">{t.kanbanDetail.acceptanceCriteria}</th>
                <th className="w-16 py-1">{t.kanbanDetail.humanReadableAcTestable}</th>
              </tr>
            </thead>
            <tbody>
              {facts.acceptanceCriteria.map((criterion) => (
                <tr key={criterion.id} className="border-t border-slate-200/70 align-top dark:border-slate-700/60">
                  <td className="py-1.5 pr-2 font-mono text-xs text-slate-500 dark:text-slate-400">{criterion.id}</td>
                  <td className="py-1.5 pr-2 leading-6 text-slate-700 dark:text-slate-200">{criterion.text}</td>
                  <td className="py-1.5 text-xs text-slate-500 dark:text-slate-400">
                    {criterion.testable ? t.kanbanDetail.humanReadableAcTestable : t.kanbanDetail.humanReadableAcNotTestable}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {facts.dependsOn.length > 0 || facts.unblockCondition ? (
          <div className="space-y-1 text-sm text-slate-700 dark:text-slate-200">
            {facts.dependsOn.length > 0 ? (
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  {t.kanbanDetail.humanReadableDependsOn}:
                </span>{" "}
                <span className="font-mono text-xs">{facts.dependsOn.join(", ")}</span>
              </div>
            ) : null}
            {facts.unblockCondition ? (
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  {t.kanbanDetail.humanReadableUnblockCondition}:
                </span>{" "}
                <span className="leading-6">{facts.unblockCondition}</span>
              </div>
            ) : null}
          </div>
        ) : null}

        {facts.sectionHeadings.length > 0 ? (
          <div className="text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold uppercase tracking-wide">{t.kanbanDetail.humanReadableSections}:</span>{" "}
            {facts.sectionHeadings.join(" · ")}
          </div>
        ) : null}
      </section>

      <section className="space-y-2 border-t border-slate-200/70 pt-3 dark:border-slate-700/70" data-testid="human-readable-summary">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
              {t.kanbanDetail.humanReadableSummary}
            </span>
            {stale && record ? (
              <span
                className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-200"
                title={t.kanbanDetail.humanReadableStaleHint}
                data-testid="human-readable-stale-badge"
              >
                {t.kanbanDetail.humanReadableStale}
              </span>
            ) : null}
            {record && record.lintHits.length > 0 ? (
              <span
                className="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:bg-rose-900/40 dark:text-rose-200"
                title={record.lintHits.join(", ")}
              >
                {t.kanbanDetail.humanReadableLintHits}: {record.lintHits.join(", ")}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            disabled={phase === "generating" || phase === "loading"}
            onClick={() => void generate(true)}
            className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {phase === "generating"
              ? t.kanbanDetail.humanReadableGenerating
              : record
                ? t.kanbanDetail.humanReadableRegenerate
                : t.kanbanDetail.humanReadableGenerate}
          </button>
        </div>

        {phase === "loading" ? (
          <div className="text-sm text-slate-500 dark:text-slate-400">{t.kanbanDetail.humanReadableLoading}</div>
        ) : null}
        {phase === "generating" && !record ? (
          <div className="text-sm text-slate-500 dark:text-slate-400">{t.kanbanDetail.humanReadableGenerating}</div>
        ) : null}
        {phase === "error" ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-900/10 dark:text-rose-300">
            {t.kanbanDetail.humanReadableFailed}: {error}
          </div>
        ) : null}
        {phase === "idle" && !record ? (
          <div className="text-sm text-slate-500 dark:text-slate-400">{t.kanbanDetail.humanReadableNoSummary}</div>
        ) : null}

        {record ? (
          <div className={stale ? "opacity-80" : undefined}>
            <SummaryBlock label={t.kanbanDetail.humanReadableWhat} body={record.summary.what} compact={compact} />
            <SummaryBlock label={t.kanbanDetail.humanReadableWhere} body={record.summary.where} compact={compact} />
            <SummaryBlock label={t.kanbanDetail.humanReadableBlockedNext} body={record.summary.blockedNext} compact={compact} />
            <div className={`border-b border-slate-200/70 ${padding} dark:border-slate-700/60`}>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                {t.kanbanDetail.humanReadableEvidence}
              </div>
              {record.summary.evidence.length > 0 ? (
                <ul className="mt-1 space-y-1 text-sm text-slate-700 dark:text-slate-200">
                  {record.summary.evidence.map((item, index) => (
                    <li key={`${item.label}-${index}`} className="leading-6">
                      <span className="font-medium">{item.label}</span>
                      {item.where ? (
                        <>
                          {" — "}
                          <span className="font-mono text-xs text-slate-600 dark:text-slate-300">{item.where}</span>
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">—</div>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-500 dark:text-slate-400">
              {generatedAt ? <span>{t.kanbanDetail.humanReadableGeneratedAt}: {generatedAt}</span> : null}
              <span>{t.kanbanDetail.humanReadableModel}: {record.model}</span>
              <span className="font-mono">{t.kanbanDetail.humanReadableBasedOn}: {shortHash(record.descriptionHash)}</span>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function SummaryBlock({ label, body, compact }: { label: string; body: string; compact: boolean }) {
  return (
    <div className={`border-b border-slate-200/70 ${compact ? "px-3 py-2.5" : "px-4 py-3"} dark:border-slate-700/60`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</div>
      <p className="mt-1 text-sm leading-6 text-slate-800 dark:text-slate-100">{body}</p>
    </div>
  );
}
