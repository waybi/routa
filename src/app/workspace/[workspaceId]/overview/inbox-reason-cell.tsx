"use client";

/** Reason cell of a Blocked row: why / what the owner decides, plus an expandable full comment (card 7fbfba57). */

import { useState } from "react";
import { buttonClassName } from "@/client/components/ui/button";
import type { InboxReasonText } from "./inbox-reason";

interface Labels {
  why: string;
  decision: string;
  expand: string;
  collapse: string;
}

export function InboxReasonCell({ reason, labels, maxChars }: { reason: InboxReasonText; labels: Labels; maxChars: number }) {
  const [open, setOpen] = useState(false);
  const clip = (text: string) => (text.length > maxChars ? `${text.slice(0, maxChars)}…` : text);
  return (
    <>
      <span className="block" data-testid="inbox-row-reason-why">
        <span className="text-secondary">{labels.why}：</span>
        <span className="text-primary">{clip(reason.why)}</span>
        <button
          type="button"
          className={`${buttonClassName("ghost", "xs")} ml-1.5`}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          data-testid="inbox-row-reason-toggle"
        >
          {open ? labels.collapse : labels.expand}
        </button>
      </span>
      {reason.decision && (
        <span className="block" data-testid="inbox-row-reason-decision">
          <span className="text-secondary">{labels.decision}：</span>
          <span className="text-primary">{clip(reason.decision)}</span>
        </span>
      )}
      {open && (
        <pre
          className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-default bg-canvas p-3 text-xs leading-relaxed text-primary"
          data-testid="inbox-row-reason-full"
        >
          {reason.full}
        </pre>
      )}
    </>
  );
}
