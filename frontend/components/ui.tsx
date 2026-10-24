import type { ComponentProps, ElementType } from "react";

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

const control = "rounded-control border border-border-strong bg-background text-foreground placeholder:text-muted disabled:opacity-60";

type Variant = "primary" | "brand" | "secondary" | "ghost";

const variants: Record<Variant, string> = {
  // The red accent: used ONLY by the Ask button. The label is 16px+ semibold (white on the red is ~3.35:1).
  primary: "border-accent bg-accent text-accent-foreground text-base font-semibold enabled:hover:bg-accent-hover enabled:hover:border-accent-hover enabled:active:bg-accent-press enabled:active:border-accent-press",
  // Filled brand purple: other confirm actions (the New-chat dialog's confirm link).
  brand: "border-brand bg-brand text-brand-foreground text-sm font-semibold enabled:hover:bg-brand/85",
  secondary: "border-brand bg-transparent text-brand text-sm font-semibold enabled:hover:bg-brand/10",
  ghost: "border-transparent bg-transparent text-brand text-sm font-semibold enabled:hover:bg-brand/10",
};

/** Button styling, also for links that look like buttons. Pill, at least 44px tall. */
export const buttonClass = (variant: Variant, className?: string) =>
  cx(
    "inline-flex min-h-11 items-center justify-center rounded-full border px-5 py-2 transition-colors disabled:opacity-60",
    variants[variant],
    className,
  );

export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button {...props} className={buttonClass(variant, className)} />;
}

/** A bordered surface; `as` picks the element (article, section, figure, ...). `pad` replaces the default padding (a `p-*` in `className` would not reliably win). */
export function Card<T extends ElementType = "div">({ as, pad = "p-4", className, ...props }: { as?: T; pad?: string } & Omit<ComponentProps<T>, "as">) {
  const Tag: ElementType = as ?? "div";
  return <Tag {...props} className={cx("rounded-card border border-border bg-background shadow-sm", pad, className)} />;
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input {...props} className={cx(control, "min-h-11 px-3 py-2 text-sm", className)} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea {...props} className={cx(control, "px-3 py-2 text-sm", className)} />;
}

/** A small pill label; `warning` (amber) for something the user should look at. */
export function Badge({ tone = "neutral", className, ...props }: ComponentProps<"span"> & { tone?: "neutral" | "warning" }) {
  const tones = { neutral: "border border-border-strong text-muted", warning: "bg-warning-bg text-warning-foreground" };
  return <span {...props} className={cx("shrink-0 rounded-full px-2 text-xs font-medium", tones[tone], className)} />;
}
