"use client";

import { useEffect, useId, useRef, useState } from "react";

import { buttonClassName } from "../ui/button";

export interface TokenPromptDialogProps {
  open: boolean;
  title: string;
  description: string;
  /** Extra context line, e.g. the repository the token is for. */
  subject?: string;
  label: string;
  placeholder?: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Element that receives focus back when the dialog closes. */
  returnFocusTo?: HTMLElement | null;
  onSubmit: (token: string) => void;
  onCancel: () => void;
}

/**
 * In-app replacement for `window.prompt` when asking for a secret token.
 * Focus moves to the password field on open, Escape cancels, and focus goes
 * back to the trigger after either outcome.
 */
export function TokenPromptDialog(props: TokenPromptDialogProps) {
  return props.open ? <TokenPromptDialogBody {...props} /> : null;
}

function TokenPromptDialogBody({
  title,
  description,
  subject,
  label,
  placeholder,
  confirmLabel,
  cancelLabel,
  returnFocusTo,
  onSubmit,
  onCancel,
}: TokenPromptDialogProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const inputId = useId();

  useEffect(() => {
    const target = returnFocusTo ?? (document.activeElement as HTMLElement | null);
    inputRef.current?.focus();
    return () => {
      if (target && target.isConnected) target.focus();
    };
  }, [returnFocusTo]);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 px-4">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-testid="token-prompt-dialog"
        className="w-full max-w-md rounded-xl border border-default bg-surface p-5 text-primary shadow-overlay"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            event.preventDefault();
            onCancel();
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (value) onSubmit(value);
        }}
      >
        <h3 id={titleId} className="m-0 text-base font-semibold text-primary">
          {title}
        </h3>
        <p id={descriptionId} className="mt-1 text-[13px] leading-relaxed text-secondary">
          {description}
        </p>
        {subject ? <p className="mt-1 font-mono text-xs text-primary">{subject}</p> : null}
        <label htmlFor={inputId} className="mt-4 block text-xs font-medium text-primary">
          {label}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="password"
          autoComplete="off"
          value={value}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          className="mt-1 w-full rounded-lg border border-default bg-surface px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent"
        />
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} data-testid="token-prompt-cancel" className={buttonClassName("secondary", "md")}>
            {cancelLabel}
          </button>
          <button type="submit" disabled={!value} data-testid="token-prompt-confirm" className={buttonClassName("primary", "md")}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
