import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "ghost" | "danger";

const BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1 disabled:opacity-50 disabled:pointer-events-none";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg shadow-sm hover:bg-teal-700 active:bg-teal-800",
  ghost: "bg-white text-slate-700 border border-surface-border hover:bg-surface-subtle hover:text-slate-900",
  danger: "bg-white text-rose-600 border border-rose-200 hover:bg-rose-50 hover:border-rose-300",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={`${BASE} ${VARIANTS[variant]} ${className}`} {...props} />;
}
