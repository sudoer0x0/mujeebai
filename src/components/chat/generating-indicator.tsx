"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export interface GeneratingIndicatorProps {
  className?: string;
}

/**
 * Animated processing indicator rendered while an assistant reply is pending or generating.
 * Replaces plain "Generating..." text with a modern, pulsating dot wave animation.
 */
export function GeneratingIndicator({ className }: GeneratingIndicatorProps) {
  const t = useTranslations("chat");

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={t("generating")}
      className={cn("inline-flex items-center gap-1.5 py-1.5 px-0.5", className)}
    >
      <span className="sr-only">{t("generating")}</span>
      <div className="flex items-center gap-1.5" aria-hidden="true">
        <span
          className="size-2 rounded-full bg-neutral-900 dark:bg-neutral-400 animate-[mujeeb-dot-pulse_1.4s_ease-in-out_infinite]"
          style={{ animationDelay: "0ms" }}
        />
        <span
          className="size-2 rounded-full bg-neutral-900 dark:bg-neutral-400 animate-[mujeeb-dot-pulse_1.4s_ease-in-out_infinite]"
          style={{ animationDelay: "200ms" }}
        />
        <span
          className="size-2 rounded-full bg-neutral-900 dark:bg-neutral-400 animate-[mujeeb-dot-pulse_1.4s_ease-in-out_infinite]"
          style={{ animationDelay: "400ms" }}
        />
      </div>
    </div>
  );
}
