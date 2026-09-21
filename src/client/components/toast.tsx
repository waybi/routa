"use client";

/**
 * Toast - Global transient feedback layer
 *
 * Why this exists: before this component, every failed user action in the
 * Kanban surface was reported with `console.error` only, so the UI stayed
 * silent while the operation had actually failed (see
 * docs/exec-plans/active/kanban-ux-feedback.md).
 *
 * Contract:
 * - `toast.success` / `toast.error` / `toast.info` show a transient message.
 * - `toast.loading` returns an id that later calls can resolve or dismiss, so
 *   long operations can show progress and then flip to their outcome.
 * - Errors are sticky by default (duration 0) because a failure the user never
 *   reads is the exact bug this layer was added to fix.
 *
 * This is deliberately dependency-free: the desktop (Tauri) bundle ships the
 * same component, so adding a third-party toast runtime would have to clear
 * that bar too.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, X } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ToastVariant = "success" | "error" | "info" | "loading";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  /** Optional secondary line rendered under the title. */
  description?: string;
  /**
   * Auto-dismiss delay in ms. `0` keeps the toast until dismissed.
   * Defaults: success/info 4000, error 0 (sticky), loading 0 (sticky).
   */
  duration?: number;
  /** Optional single action button (e.g. "Open card"). */
  action?: ToastAction;
  /**
   * Stable identity. Re-emitting with the same id replaces the existing toast
   * in place instead of stacking a duplicate — used to resolve `loading`
   * toasts and to collapse repeated poll failures.
   */
  id?: string;
}

export interface ToastRecord extends ToastOptions {
  id: string;
  variant: ToastVariant;
  title: string;
  createdAt: number;
}

type ToastInput = Omit<ToastRecord, "createdAt">;

interface ToastContextValue {
  toasts: ToastRecord[];
  push: (toast: ToastInput) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const MAX_VISIBLE_TOASTS = 4;

function defaultDuration(variant: ToastVariant): number {
  switch (variant) {
    case "success":
      return 4000;
    case "info":
      return 5000;
    case "error":
      return 0;
    case "loading":
      return 0;
  }
}

// ─── Imperative bridge ───────────────────────────────────────────────────────
//
// Call sites are mostly inside `useCallback` handlers that already have long
// dependency arrays; threading a hook through every one of them would make the
// diff about plumbing instead of about feedback. A module-level bridge keeps
// the call sites to a single line. The provider registers itself on mount.

let bridgePush: ((toast: ToastInput) => string) | null = null;
let bridgeDismiss: ((id: string) => void) | null = null;
let fallbackCounter = 0;

function nextId(prefix: string): string {
  fallbackCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${fallbackCounter}`;
}

function emit(variant: ToastVariant, title: string, options?: ToastOptions): string {
  const id = options?.id ?? nextId("toast");
  if (!bridgePush) {
    // No provider mounted (SSR, tests, or a surface that has not adopted the
    // layer yet). Keep the console breadcrumb so nothing is lost silently.
    if (variant === "error") {
      console.error(`[toast:error] ${title}`, options?.description ?? "");
    }
    return id;
  }
  return bridgePush({ ...options, id, variant, title });
}

export const toast = {
  success: (title: string, options?: ToastOptions) => emit("success", title, options),
  error: (title: string, options?: ToastOptions) => emit("error", title, options),
  info: (title: string, options?: ToastOptions) => emit("info", title, options),
  loading: (title: string, options?: ToastOptions) => emit("loading", title, options),
  dismiss: (id: string) => {
    bridgeDismiss?.(id);
  },
};

// ─── Provider ────────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    for (const timer of timersRef.current.values()) clearTimeout(timer);
    timersRef.current.clear();
    setToasts([]);
  }, []);

  const push = useCallback((input: ToastInput) => {
    const record: ToastRecord = { ...input, createdAt: Date.now() };

    setToasts((current) => {
      const existingIndex = current.findIndex((item) => item.id === record.id);
      const next = existingIndex >= 0
        ? current.map((item, index) => (index === existingIndex ? record : item))
        : [...current, record];
      // Drop the oldest when the stack would cover the viewport.
      return next.length > MAX_VISIBLE_TOASTS ? next.slice(next.length - MAX_VISIBLE_TOASTS) : next;
    });

    const previousTimer = timersRef.current.get(record.id);
    if (previousTimer) {
      clearTimeout(previousTimer);
      timersRef.current.delete(record.id);
    }

    const duration = record.duration ?? defaultDuration(record.variant);
    if (duration > 0) {
      const timer = setTimeout(() => {
        timersRef.current.delete(record.id);
        setToasts((current) => current.filter((item) => item.id !== record.id));
      }, duration);
      timersRef.current.set(record.id, timer);
    }

    return record.id;
  }, []);

  useEffect(() => {
    bridgePush = push;
    bridgeDismiss = dismiss;
    return () => {
      if (bridgePush === push) bridgePush = null;
      if (bridgeDismiss === dismiss) bridgeDismiss = null;
    };
  }, [push, dismiss]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({ toasts, push, dismiss, dismissAll }),
    [toasts, push, dismiss, dismissAll],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}

// ─── Viewport ────────────────────────────────────────────────────────────────

const VARIANT_STYLES: Record<ToastVariant, { ring: string; icon: string }> = {
  success: {
    ring: "border-emerald-200 bg-white dark:border-emerald-900/50 dark:bg-[#12141c]",
    icon: "text-emerald-500",
  },
  error: {
    ring: "border-rose-300 bg-white dark:border-rose-900/60 dark:bg-[#12141c]",
    icon: "text-rose-500",
  },
  info: {
    ring: "border-sky-200 bg-white dark:border-sky-900/50 dark:bg-[#12141c]",
    icon: "text-sky-500",
  },
  loading: {
    ring: "border-slate-200 bg-white dark:border-slate-700 dark:bg-[#12141c]",
    icon: "text-slate-400",
  },
};

function ToastIcon({ variant }: { variant: ToastVariant }) {
  const className = `h-4 w-4 shrink-0 ${VARIANT_STYLES[variant].icon}`;
  switch (variant) {
    case "success":
      return <CheckCircle2 className={className} aria-hidden="true" />;
    case "error":
      return <AlertTriangle className={className} aria-hidden="true" />;
    case "info":
      return <Info className={className} aria-hidden="true" />;
    case "loading":
      return <Loader2 className={`${className} animate-spin`} aria-hidden="true" />;
  }
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastRecord[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      role="region"
      aria-label="Notifications"
      data-testid="toast-viewport"
    >
      {toasts.map((item) => (
        <div
          key={item.id}
          data-testid={`toast-${item.variant}`}
          role={item.variant === "error" ? "alert" : "status"}
          aria-live={item.variant === "error" ? "assertive" : "polite"}
          className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3.5 py-3 shadow-lg ${VARIANT_STYLES[item.variant].ring}`}
        >
          <ToastIcon variant={item.variant} />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium leading-5 text-slate-900 dark:text-slate-100">
              {item.title}
            </div>
            {item.description && (
              <div className="mt-0.5 break-words text-xs leading-5 text-slate-500 dark:text-slate-400">
                {item.description}
              </div>
            )}
            {item.action && (
              <button
                type="button"
                onClick={() => {
                  item.action?.onClick();
                  onDismiss(item.id);
                }}
                className="mt-1.5 text-xs font-medium text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
              >
                {item.action.label}
              </button>
            )}
          </div>
          {item.variant !== "loading" && (
            <button
              type="button"
              onClick={() => onDismiss(item.id)}
              aria-label="Dismiss"
              className="shrink-0 rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-[#1f232f] dark:hover:text-slate-200"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
