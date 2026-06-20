import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "destructive" | "ghost";

const BASE =
  "focus-ring inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none";

const VARIANTS: Record<Variant, string> = {
  // CTA — solid brand indigo.
  primary: "bg-primary-strong text-primary-fg hover:bg-primary-hover",
  // Low-emphasis neutral outline.
  secondary: "border border-border bg-surface text-foreground hover:bg-muted",
  // Neutral outline that resolves to destructive on hover.
  destructive:
    "border border-border bg-surface text-foreground hover:border-error hover:text-error hover:bg-[color-mix(in_srgb,var(--error)_10%,var(--surface))]",
  // Minimal — for inline actions like Connect/Copy.
  ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={`${BASE} ${VARIANTS[variant]} ${className}`} {...props} />;
}
