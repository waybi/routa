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
import { buttonClassName } from "./ui/button";

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
          aria-labelledby={pending.title ? "confirm-dialog-title" : undefined}
          aria-describedby="confirm-dialog-message"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              settle(false);
            }
          }}
        >
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-default bg-surface text-primary shadow-overlay">
            <div className="p-5">
              <div className="flex items-start gap-3">
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                    pending.destructive ? "bg-danger-subtle text-danger" : "bg-attention-subtle text-attention"
                  }`}
                >
                  <TriangleAlert className="h-[18px] w-[18px]" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  {pending.title && (
                    <h3 id="confirm-dialog-title" className="m-0 text-base font-semibold leading-snug text-primary">
                      {pending.title}
                    </h3>
                  )}
                  <p
                    id="confirm-dialog-message"
                    className="mt-1 whitespace-pre-line break-words text-[13px] leading-relaxed text-secondary"
                  >
                    {pending.message}
                  </p>
                </div>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => settle(false)}
                  data-testid="confirm-dialog-cancel"
                  className={buttonClassName("secondary", "md")}
                >
                  {pending.cancelLabel ?? t.common.cancel}
                </button>
                <button
                  type="button"
                  onClick={() => settle(true)}
                  data-testid="confirm-dialog-confirm"
                  autoFocus
                  className={buttonClassName(pending.destructive ? "danger" : "primary", "md")}
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
