import type { ComponentProps, ElementType } from "react";

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

const control = "rounded-control border border-border-strong bg-background text-foreground placeholder:text-muted disabled:opacity-60";

/** Button styling, also for links that look like buttons. `primary` is the accent-filled action; `secondary` is outlined. */
export const buttonClass = (variant: "primary" | "secondary", className?: string) =>
  cx(
    "inline-block rounded-control border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60",
    variant === "primary"
      ? "border-accent bg-accent text-accent-foreground enabled:hover:brightness-110"
      : "border-border-strong bg-background text-foreground enabled:hover:bg-surface",
    className,
  );

export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: "primary" | "secondary" }) {
  return <button {...props} className={buttonClass(variant, className)} />;
}

/** A bordered surface; `as` picks the element (article, section, figure, ...). */
export function Card<T extends ElementType = "div">({ as, className, ...props }: { as?: T } & Omit<ComponentProps<T>, "as">) {
  const Tag: ElementType = as ?? "div";
  return <Tag {...props} className={cx("rounded-card border border-border bg-surface p-4", className)} />;
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input {...props} className={cx(control, "p-2 text-sm", className)} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea {...props} className={cx(control, "p-2 text-sm", className)} />;
}

/** A small bordered label; `warning` for something the user should look at. */
export function Badge({ tone = "neutral", className, ...props }: ComponentProps<"span"> & { tone?: "neutral" | "warning" }) {
  const tones = { neutral: "border-border-strong text-muted", warning: "border-warning text-warning" };
  return <span {...props} className={cx("shrink-0 rounded-control border px-1.5 text-xs", tones[tone], className)} />;
}
