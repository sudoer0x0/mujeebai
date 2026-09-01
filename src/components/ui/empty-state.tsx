import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The one empty state.
 *
 * Always answers three questions: what is missing, why, and what the user
 * can do next. An empty state with no action is a dead end, so `action`
 * is strongly encouraged wherever the user can actually do something.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      {Icon ? (
        <div className="mb-3 flex size-9 items-center justify-center rounded-md border border-line bg-surface-raised">
          <Icon className="size-4 text-muted" aria-hidden />
        </div>
      ) : null}
      <p className="text-[14px] font-semibold text-foreground">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
