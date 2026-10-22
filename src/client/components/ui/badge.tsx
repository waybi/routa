"use client";

import type { ReactNode } from "react";

/**
 * Five status tones from design-spec §5 ("状态标签"): neutral, info,
 * attention (needs confirmation), danger (failed), success (passed).
 * Color never carries meaning alone — both components always render text.
 */
export type Tone = "neutral" | "info" | "attention" | "danger" | "success";

export const TONES: readonly Tone[] = ["neutral", "info", "attention", "danger", "success"];

const BADGE_TONE: Record<Tone, string> = {
  neutral: "bg-subtle text-secondary",
  info: "bg-accent-subtle text-information",
  attention: "bg-attention-subtle text-attention",
  danger: "bg-danger-subtle text-danger",
  success: "bg-success-subtle text-success",
};

const DOT_TONE: Record<Tone, string> = {
  neutral: "bg-secondary",
  info: "bg-information",
  attention: "bg-attention",
  danger: "bg-danger",
  success: "bg-success",
};

export interface BadgeProps {
  tone?: Tone;
  /** Required visible text; a badge without words is not allowed. */
  children: ReactNode;
  className?: string;
}

export function Badge({ tone = "neutral", children, className = "" }: BadgeProps) {
  return (
    <span
      data-tone={tone}
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] leading-normal ${BADGE_TONE[tone]} ${className}`.trim()}
    >
      {children}
    </span>
  );
}

export interface StatusDotProps {
  tone?: Tone;
  /** Required visible label shown next to the dot. */
  label: ReactNode;
  /** Live work: the dot pulses, except under prefers-reduced-motion. */
  pulse?: boolean;
  className?: string;
}

export function StatusDot({ tone = "neutral", label, pulse = false, className = "" }: StatusDotProps) {
  const motion = pulse ? " motion-safe:animate-pulse" : "";
  return (
    <span data-tone={tone} className={`inline-flex min-w-0 items-center gap-1.5 text-xs text-secondary ${className}`.trim()}>
      <span aria-hidden="true" className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${DOT_TONE[tone]}${motion}`} />
      <span>{label}</span>
    </span>
  );
}
