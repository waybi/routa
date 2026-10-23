/**
 * "Directly visible" check for the restored legacy features (design-spec
 * §12, boss's rule of 2026-10-23: features of the old UI are neither removed
 * nor hidden). An element passes when no ancestor (itself included) is
 * inside a closed <details>, carries the `hidden` attribute or
 * aria-hidden="true", or has a hiding class: hidden, invisible, opacity-0,
 * sr-only, any group-hover: class, or a responsive hide such as
 * max-[800px]:hidden / md:hidden (narrow screens must not hide them).
 * Classes are split on whitespace and matched exactly, so `max-w-hidden`
 * style substrings do not count.
 */

const PLAIN_HIDING_CLASSES = new Set(["hidden", "invisible", "opacity-0", "sr-only"]);

export function hidingReason(element: Element): string | null {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const label = `<${node.tagName.toLowerCase()}${node.getAttribute("data-testid") ? ` data-testid="${node.getAttribute("data-testid")}"` : ""}>`;
    if (node.tagName === "DETAILS" && !node.hasAttribute("open")) return `${label} is a closed <details>`;
    if (node.hasAttribute("hidden")) return `${label} has the hidden attribute`;
    if (node.getAttribute("aria-hidden") === "true") return `${label} has aria-hidden="true"`;
    const classes = (node.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
    for (const cls of classes) {
      if (PLAIN_HIDING_CLASSES.has(cls)) return `${label} has class ${cls}`;
      if (cls.startsWith("group-hover:")) return `${label} has class ${cls} (only shows on hover)`;
      const variantSplit = cls.lastIndexOf(":");
      if (variantSplit > 0 && PLAIN_HIDING_CLASSES.has(cls.slice(variantSplit + 1))) {
        return `${label} has responsive hiding class ${cls}`;
      }
    }
  }
  return null;
}

/** Throws with the reason when the element is hidden by any of the rules above. */
export function assertDirectlyVisible(element: Element | null | undefined, name = "element"): void {
  if (!element) throw new Error(`${name} is not in the document`);
  if (!element.isConnected) throw new Error(`${name} is detached from the document`);
  const reason = hidingReason(element);
  if (reason) throw new Error(`${name} is not directly visible: ${reason}`);
}
