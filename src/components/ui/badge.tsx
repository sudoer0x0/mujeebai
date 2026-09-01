import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Status/label chip.
 *
 * Every status variant pairs a tinted surface with matching *text*
 * colour, and callers are expected to put a word inside — state is never
 * conveyed by hue alone (WCAG 1.4.1).
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap",
  {
    variants: {
      variant: {
        neutral: "border-line bg-surface-raised text-muted",
        accent: "border-transparent bg-accent-soft text-accent",
        success: "border-transparent bg-success-soft text-success",
        warning: "border-transparent bg-warning-soft text-warning",
        danger: "border-transparent bg-danger-soft text-danger",
        outline: "border-line-strong bg-transparent text-muted",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/**
 * Small coloured dot for dense status columns. Always render it next to a
 * text label — never on its own.
 */
export function StatusDot({ variant = "neutral", className }: { variant?: BadgeVariant; className?: string }) {
  const tone =
    variant === "success"
      ? "bg-success"
      : variant === "warning"
        ? "bg-warning"
        : variant === "danger"
          ? "bg-danger"
          : variant === "accent"
            ? "bg-accent"
            : "bg-faint";
  return <span aria-hidden className={cn("inline-block size-1.5 shrink-0 rounded-full", tone, className)} />;
}
