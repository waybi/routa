// Small reusable UI components for the workspace dashboard

import React from "react";
import { Check, CircleCheck, Clock, X, CircleOff, XCircle } from "lucide-react";
import { getActiveLocale } from "@/i18n/context";
import type { Locale } from "@/i18n/types";
import type { SessionDetailRedesignTranslationDictionarySections } from "@/i18n/types-session-detail";
import { enSessionDetail } from "@/i18n/locales/en-session-detail";
import { zhSessionDetail } from "@/i18n/locales/zh-session-detail";


// ─── Tab Button ────────────────────────────────────────────────────

export function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3.5 py-2 text-[13px] font-medium border-b-2 transition-colors ${
        active
          ? "text-primary border-accent"
          : "text-secondary border-transparent hover:text-primary hover:border-default"
      }`}
    >
      {children}
    </button>
  );
}

// ─── Stat Card ─────────────────────────────────────────────────────

export function StatCard({
  label,
  value,
  sub,
  icon,
  color,
}: {
  label: string;
  value: number;
  sub?: string;
  icon: React.ReactNode;
  color: "blue" | "route" | "emerald" | "amber";
}) {
  const bgMap = {
    blue: "bg-accent-subtle",
    route: "bg-subtle",
    emerald: "bg-success-subtle",
    amber: "bg-attention-subtle",
  };
  const textMap = {
    blue: "text-information",
    route: "text-secondary",
    emerald: "text-success",
    amber: "text-attention",
  };

  return (
    <div className="flex items-center gap-3 p-4 rounded-xl bg-surface border border-default hover:shadow-sm transition-shadow">
      <div className={`w-9 h-9 rounded-lg ${bgMap[color]} flex items-center justify-center shrink-0 ${textMap[color]}`}>
        {icon}
      </div>
      <div>
        <div className="text-xl font-bold text-primary tabular-nums leading-none">{value}</div>
        <div className="text-[11px] text-secondary mt-0.5">
          {label}
          {sub && <span className="ml-1 text-secondary">· {sub}</span>}
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard Card ────────────────────────────────────────────────

export function DashboardCard({
  title,
  count,
  emptyText,
  action,
  children,
}: {
  title: string;
  count?: number;
  emptyText?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const isEmpty = count === 0;

  return (
    <div className="bg-surface rounded-xl border border-default overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-default">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-semibold text-primary">{title}</h3>
          {count !== undefined && count > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-subtle text-[10px] font-mono text-secondary">
              {count}
            </span>
          )}
        </div>
        {action}
      </div>
      {isEmpty ? (
        <div className="px-4 py-6 text-center text-[12px] text-secondary">{emptyText}</div>
      ) : (
        <div className="divide-y divide-default">{children}</div>
      )}
    </div>
  );
}

// ─── Task Status Icon ──────────────────────────────────────────────

export function TaskStatusIcon({ status }: { status: string }) {
  const s = status.toUpperCase();
  if (s === "COMPLETED") {
    return (
      <div className="w-7 h-7 rounded-md bg-success-subtle flex items-center justify-center shrink-0">
        <Check className="w-3.5 h-3.5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}/>
      </div>
    );
  }
  if (s === "IN_PROGRESS") {
    return (
      <div className="w-7 h-7 rounded-md bg-accent-subtle flex items-center justify-center shrink-0">
        <div className="w-3 h-3 rounded-full border-2 border-information border-t-transparent animate-spin" />
      </div>
    );
  }
  if (s === "BLOCKED" || s === "CANCELLED") {
    return (
      <div className="w-7 h-7 rounded-md bg-danger-subtle flex items-center justify-center shrink-0">
        <CircleOff className="w-3.5 h-3.5 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
      </div>
    );
  }
  return (
    <div className="w-7 h-7 rounded-md bg-subtle flex items-center justify-center shrink-0">
      <div className="w-2.5 h-2.5 rounded-full border-2 border-secondary" />
    </div>
  );
}

// ─── Task Status Badge ─────────────────────────────────────────────

export function TaskStatusBadge({ status }: { status: string }) {
  const s = status.toUpperCase();
  const map: Record<string, string> = {
    PENDING: "bg-subtle text-secondary",
    IN_PROGRESS: "bg-accent-subtle text-information",
    REVIEW_REQUIRED: "bg-attention-subtle text-attention",
    COMPLETED: "bg-success-subtle text-success",
    NEEDS_FIX: "bg-attention-subtle text-attention",
    BLOCKED: "bg-danger-subtle text-danger",
    CANCELLED: "bg-subtle text-secondary",
  };

  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${map[s] || map.PENDING}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

// ─── Agent Role Icon ───────────────────────────────────────────────

export function AgentRoleIcon({ role }: { role: string }) {
  const r = role.toUpperCase();
  const colorMap: Record<string, string> = {
    ROUTA: "bg-accent-subtle text-information",
    DEVELOPER: "bg-subtle text-secondary",
    CRAFTER: "bg-attention-subtle text-attention",
    GATE: "bg-success-subtle text-success",
  };
  const cls = colorMap[r] || colorMap.DEVELOPER;

  return (
    <div className={`w-7 h-7 rounded-md ${cls} flex items-center justify-center shrink-0`}>
      <span className="text-[10px] font-bold">{r.charAt(0)}</span>
    </div>
  );
}

// ─── Agent Status Dot ──────────────────────────────────────────────

export function AgentStatusDot({ status }: { status: string }) {
  const s = status.toUpperCase();
  const colorMap: Record<string, string> = {
    ACTIVE: "bg-success",
    PENDING: "bg-attention",
    COMPLETED: "bg-secondary",
    ERROR: "bg-danger",
    CANCELLED: "bg-default",
  };

  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full ${colorMap[s] || colorMap.PENDING}`} />
      <span className="text-[10px] text-secondary capitalize">{status.toLowerCase()}</span>
    </div>
  );
}

// ─── Overlay Modal ─────────────────────────────────────────────────

export function OverlayModal({
  onClose,
  title,
  children,
  closeLabel,
}: {
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  closeLabel?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        className="relative w-full max-w-5xl h-[80vh] bg-surface border border-default rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-11 px-4 border-b border-default flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-primary">{title}</span>
            <a
              href="/settings/agents"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-secondary hover:text-primary transition-colors"
            >
              Open in new tab
            </a>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-hover text-secondary hover:text-primary transition-colors"
            title={closeLabel ?? "Close (Esc)"}
            aria-label={closeLabel ?? "Close"}
          >
            <X className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          </button>
        </div>
        <div className="h-[calc(80vh-44px)]">{children}</div>
      </div>
    </div>
  );
}

// ─── BG Task Status Helpers ────────────────────────────────────────

export function bgTaskStatusClass(status: string): string {
  switch (status) {
    case "PENDING":   return "bg-subtle text-secondary";
    case "RUNNING":   return "bg-accent-subtle text-information";
    case "COMPLETED": return "bg-success-subtle text-success";
    case "FAILED":    return "bg-danger-subtle text-danger";
    case "CANCELLED": return "bg-subtle text-secondary";
    default:          return "bg-subtle text-secondary";
  }
}

export function BgTaskStatusIcon({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    PENDING: "text-secondary",
    RUNNING: "text-information animate-spin",
    COMPLETED: "text-success",
    FAILED: "text-danger",
    CANCELLED: "text-secondary",
  };
  const cls = colorMap[status] ?? "text-secondary";
  if (status === "COMPLETED") {
    return (
      <CircleCheck className={`w-4 h-4 ${cls} shrink-0`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
    );
  }
  if (status === "FAILED" || status === "CANCELLED") {
    return (
      <XCircle className={`w-4 h-4 ${cls} shrink-0`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
    );
  }
  return (
    <Clock className={`w-4 h-4 ${cls} shrink-0`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
  );
}

// ─── Format Relative Time ──────────────────────────────────────────

export type RelativeTimeCopy = SessionDetailRedesignTranslationDictionarySections["sessionDetailRedesign"]["relativeTime"];

const RELATIVE_TIME_COPY: Record<Locale, RelativeTimeCopy> = {
  en: enSessionDetail.sessionDetailRedesign.relativeTime,
  zh: zhSessionDetail.sessionDetailRedesign.relativeTime,
};

/**
 * "8m ago" / "8 分钟前". Without `copy` the text follows the current UI
 * locale; the locale is read from `@/i18n/context` (not the `@/i18n` entry)
 * so tests that mock `@/i18n` keep working.
 */
export function formatRelativeTime(dateStr: string, copy?: RelativeTimeCopy): string {
  const text = copy ?? RELATIVE_TIME_COPY[getActiveLocale()] ?? RELATIVE_TIME_COPY.en;
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return text.justNow;
  if (mins < 60) return text.minutesAgo.replace("{count}", String(mins));
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return text.hoursAgo.replace("{count}", String(hrs));
  const days = Math.floor(hrs / 24);
  if (days < 7) return text.daysAgo.replace("{count}", String(days));
  return text.weeksAgo.replace("{count}", String(Math.floor(days / 7)));
}
