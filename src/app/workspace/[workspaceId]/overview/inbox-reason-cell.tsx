"use client";

/** Reason cell of a Blocked row: headline / action, plus an expandable full comment (card 7fbfba57). */

import { useState } from "react";
import { buttonClassName } from "@/client/components/ui/button";
import type { InboxReasonText } from "./inbox-reason";

interface Labels {
  expand: string;
  collapse: string;
}

export function InboxReasonCell({ reason, labels, maxChars }: { reason: InboxReasonText; labels: Labels; maxChars: number }) {
  const [open, setOpen] = useState(false);
  const clip = (text: string) => (text.length > maxChars ? `${text.slice(0, maxChars)}…` : text);
  return (
    <>
      <span className="block font-semibold text-primary" data-testid="inbox-row-reason-why">
        {clip(reason.headline)}
        <button
          type="button"
          className={`${buttonClassName("ghost", "xs")} ml-1.5 font-normal`}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          data-testid="inbox-row-reason-toggle"
        >
          {open ? labels.collapse : labels.expand}
        </button>
      </span>
      {reason.action && (
        <span className="block text-secondary" data-testid="inbox-row-reason-decision">{clip(reason.action)}</span>
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
