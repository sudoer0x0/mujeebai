import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const TONES = {
  info: { surface: "bg-surface-raised border-line", text: "text-foreground", icon: Info, iconColor: "text-muted" },
  success: { surface: "bg-success-soft border-success/25", text: "text-foreground", icon: CheckCircle2, iconColor: "text-success" },
  warning: { surface: "bg-warning-soft border-warning/25", text: "text-foreground", icon: AlertTriangle, iconColor: "text-warning" },
  danger: { surface: "bg-danger-soft border-danger/25", text: "text-foreground", icon: XCircle, iconColor: "text-danger" },
} as const;

export type AlertTone = keyof typeof TONES;

/**
 * Inline status message.
 *
 * Carries an icon *and* a colour *and* text, never colour alone (WCAG
 * 1.4.1). Error and warning alerts render as `role="alert"` so they are
 * announced when they appear mid-form; informational ones do not, to
 * avoid interrupting the user for something they did not act on.
 */
export function Alert({
  tone = "info",
  title,
  children,
  className,
  action,
}: {
  tone?: AlertTone;
  title?: string;
  children?: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  const config = TONES[tone];
  const Icon = config.icon;
  const assertive = tone === "danger" || tone === "warning";

  return (
    <div
      role={assertive ? "alert" : "status"}
      className={cn("flex items-start gap-2.5 rounded-md border px-3 py-2.5", config.surface, config.text, className)}
    >
      <Icon className={cn("mt-px size-4 shrink-0", config.iconColor)} aria-hidden />
      <div className="min-w-0 flex-1 text-[13px] leading-relaxed">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(title && "mt-0.5 text-muted")}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
