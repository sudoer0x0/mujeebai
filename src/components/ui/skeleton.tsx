import { cn } from "@/lib/utils";

/** Placeholder block shown while content loads. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn("pulse rounded-sm bg-surface-raised", className)} {...props} />;
}
