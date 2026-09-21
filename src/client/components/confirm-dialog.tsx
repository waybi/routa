"use client";

/**
 * Promise-based confirmation dialog.
 *
 * Replaces `window.confirm`, which blocks the main thread, cannot be styled
 * or themed, and (in at least one case) shipped hardcoded English past the
 * i18n rule. The API is deliberately shaped like `window.confirm` so call
 * sites change by one `await`:
 *
 *   const ok = window.confirm(message)   →   const ok = await confirm({ message })
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { TriangleAlert } from "lucide-react";
import { useTranslation } from "@/i18n";

export interface ConfirmOptions {
  /** Main line. Required — the user must know what they are agreeing to. */
  message: string;
  /** Optional heading above the message. */
  title?: string;
  /** Confirm button label; defaults to the shared "Confirm" string. */
  confirmLabel?: string;
  /** Cancel button label; defaults to the shared "Cancel" string. */
  cancelLabel?: string;
  /** Renders the confirm button in a destructive style. */
  destructive?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * Returns a `confirm(options) => Promise<boolean>`.
 *
 * Falls back to resolving `true` when no provider is mounted, matching the
 * previous behavior closely enough that a missing provider cannot silently
 * block a user action.
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  return ctx ?? (async () => true);
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const pendingRef = useRef<PendingConfirm | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    // A second request while one is open resolves the first as cancelled
    // rather than losing its promise.
    pendingRef.current?.resolve(false);

    return new Promise<boolean>((resolve) => {
      const next: PendingConfirm = { ...options, resolve };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    pendingRef.current?.resolve(value);
    pendingRef.current = null;
    setPending(null);
  }, []);

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {pending && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 px-4"
          data-testid="confirm-dialog"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-[#1c1f2e] dark:bg-[#12141c]">
            <div className="p-6">
              <div className="flex items-start gap-4">
                <div
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${
                    pending.destructive
                      ? "bg-rose-100 dark:bg-rose-900/20"
                      : "bg-amber-100 dark:bg-amber-900/20"
                  }`}
                >
                  <TriangleAlert
                    className={`h-6 w-6 ${
                      pending.destructive
                        ? "text-rose-600 dark:text-rose-400"
                        : "text-amber-600 dark:text-amber-400"
                    }`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  {pending.title && (
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                      {pending.title}
                    </h3>
                  )}
                  <p className="mt-1 whitespace-pre-line break-words text-sm text-slate-600 dark:text-slate-400">
                    {pending.message}
                  </p>
                </div>
              </div>
              <div className="mt-6 flex gap-3">
                <button
                  onClick={() => settle(false)}
                  data-testid="confirm-dialog-cancel"
                  className="flex-1 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-[#0d1018] dark:text-slate-300 dark:hover:bg-[#191c28]"
                >
                  {pending.cancelLabel ?? t.common.cancel}
                </button>
                <button
                  onClick={() => settle(true)}
                  data-testid="confirm-dialog-confirm"
                  autoFocus
                  className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium text-white ${
                    pending.destructive
                      ? "bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600"
                      : "bg-amber-500 hover:bg-amber-600"
                  }`}
                >
                  {pending.confirmLabel ?? t.common.confirm}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
