"use client";

/**
 * Compatibility entry: the button now lives in ./ui/button with the
 * redesign tokens. Existing imports from this path keep working.
 */
export { Button, buttonClassName, type ButtonProps, type ButtonSize, type ButtonVariant } from "./ui/button";
