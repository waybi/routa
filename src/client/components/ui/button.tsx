"use client";

import React, { type ButtonHTMLAttributes, forwardRef } from "react";
import { LoaderCircle } from "lucide-react";

/**
 * Redesign button. Four visual variants from design-spec §5; the two
 * `desktop-*` names are kept as aliases so pre-redesign call sites keep
 * compiling while later cards migrate them.
 */
export type ButtonVariant =
  | "primary"
  | "secondary"
  | "danger"
  | "ghost"
  | "desktop-secondary"
  | "desktop-accent";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-control border font-medium transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50";

const VARIANT: Record<"primary" | "secondary" | "danger" | "ghost", string> = {
  primary: "border-accent bg-accent font-semibold text-on-accent hover:opacity-90",
  secondary: "border-default bg-surface text-primary hover:bg-hover",
  danger: "border-danger bg-surface text-danger hover:bg-danger-subtle",
  ghost: "border-transparent bg-transparent text-secondary hover:bg-hover hover:text-primary",
};

const SIZE: Record<ButtonSize, string> = {
  xs: "min-h-6 px-2 py-0.5 text-[11px]",
  sm: "min-h-7 px-2.5 py-1 text-xs",
  md: "min-h-[34px] px-3 py-1.5 text-[13px]",
  lg: "min-h-10 px-4 py-2 text-sm",
};

export function resolveButtonVariant(variant: ButtonVariant): keyof typeof VARIANT {
  if (variant === "desktop-secondary") return "secondary";
  if (variant === "desktop-accent") return "primary";
  return variant;
}

export function buttonClassName(variant: ButtonVariant = "primary", size: ButtonSize = "md"): string {
  return `${BASE} ${VARIANT[resolveButtonVariant(variant)]} ${SIZE[size]}`;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", loading, disabled, className = "", children, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      data-variant={resolveButtonVariant(variant)}
      className={`${buttonClassName(variant, size)} ${className}`.trim()}
      {...props}
    >
      {loading ? (
        <LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      ) : null}
      {children}
    </button>
  ),
);

Button.displayName = "Button";
