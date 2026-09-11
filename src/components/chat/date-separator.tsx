"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface DateSeparatorProps {
  label: string;
  date?: string | Date;
  className?: string;
}

/**
 * Centered date divider badge shown between messages sent on different days,
 * or at the start of a conversation. Matches the reference styling.
 */
export function DateSeparator({ label, date, className }: DateSeparatorProps) {
  const isoString = date ? (date instanceof Date ? date.toISOString() : date) : undefined;

  return (
    <div
      role="separator"
      aria-label={label}
      className={cn("my-3 flex items-center justify-center select-none sm:my-4", className)}
    >
      <span className="inline-flex items-center justify-center rounded-lg border border-line/60 bg-surface/85 px-3 py-0.5 text-[11px] font-medium text-muted/90 shadow-2xs backdrop-blur-xs sm:text-[12px]">
        {isoString ? (
          <time dateTime={isoString} suppressHydrationWarning>
            {label}
          </time>
        ) : (
          label
        )}
      </span>
    </div>
  );
}
