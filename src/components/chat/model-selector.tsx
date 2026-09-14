"use client";

import * as React from "react";
import { ChevronDown, Lock, Check, Brain, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ModelOption } from "@/components/chat/types";

function getModelIcon(model?: ModelOption | null) {
  if (!model) return null;
  const name = model.displayName.toLowerCase();
  if (name.includes("think") || model.slug.includes("reasoning")) {
    return <Brain className="size-3.5 shrink-0 text-accent/90" aria-hidden />;
  }
  if (name.includes("fast") || model.slug.includes("free")) {
    return <Zap className="size-3.5 shrink-0 text-amber-500/90" aria-hidden />;
  }
  return null;
}

/**
 * Model picker, driven entirely by `/api/models`.
 *
 * The list, the grouping and the locked states all come from the registry
 * — no provider or model identifier is hardcoded here, so an admin adding
 * or locking a model changes this menu with no code change (#13, #146).
 * Locked entries stay visible but unselectable: they communicate what a
 * subscription unlocks instead of silently not existing.
 */
export function ModelSelector({
  value,
  onChange,
  disabled,
  compact,
}: {
  value: string | null;
  onChange: (slug: string) => void;
  disabled?: boolean;
  /**
   * Renders inside the composer pill rather than as a standalone control:
   * tighter, pill-shaped, and it truncates harder because it is sharing a
   * row with the text area and the send button.
   */
  compact?: boolean;
}) {
  const t = useTranslations("models");
  const [models, setModels] = React.useState<ModelOption[] | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    fetch("/api/models", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : { models: [] }))
      .then((data: { models: ModelOption[] }) => setModels(data.models ?? []))
      .catch(() => setModels([]));
    return () => controller.abort();
  }, []);

  if (models === null) return <Skeleton className={compact ? "h-7 w-20 rounded-full" : "h-7 w-40"} />;

  const available = models.filter((model) => model.unlocked);
  const locked = models.filter((model) => !model.unlocked);
  const current = models.find((model) => model.slug === value) ?? available[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled || available.length === 0}
          className={cn(
            "inline-flex items-center gap-1.5 font-medium text-muted transition-colors hover:bg-surface-raised hover:text-foreground disabled:opacity-50",
            compact
              ? "rounded-full px-2.5 py-1 text-[13px] hover:bg-surface-subtle"
              : "rounded-sm px-1.5 py-1 text-[12px]",
          )}
        >
          {getModelIcon(current)}
          <span className="truncate">{current?.displayName ?? "Fast"}</span>
          {!compact ? <ChevronDown className="size-3 shrink-0 text-faint" aria-hidden /> : null}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" side="top" className="w-72">
        <DropdownMenuLabel>{t("selector.freeGroup")}</DropdownMenuLabel>
        {available.map((model) => (
          <DropdownMenuItem
            key={model.slug}
            onSelect={() => onChange(model.slug)}
            className="flex-col items-start gap-0.5 py-2 cursor-pointer"
          >
            <span className="flex w-full items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                {getModelIcon(model)}
                {model.displayName}
              </span>
              {model.slug === current?.slug ? <Check className="size-3.5 shrink-0 text-accent" aria-hidden /> : null}
            </span>
            {model.description ? (
              <span className="text-[12px] leading-snug text-muted">{model.description}</span>
            ) : null}
          </DropdownMenuItem>
        ))}

        {locked.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t("selector.moreGroup")}</DropdownMenuLabel>
            {locked.map((model) => (
              <div key={model.slug} className="flex flex-col gap-0.5 rounded-sm px-2 py-2 opacity-70">
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[13px] text-foreground">
                    <Lock className="size-3 shrink-0 text-faint" aria-hidden />
                    {model.displayName}
                  </span>
                  <Badge variant="neutral">
                    {model.availability === "available" ? t("selector.lockedPro") : t("selector.lockedComingSoon")}
                  </Badge>
                </span>
                {model.description ? (
                  <span className="text-[12px] leading-snug text-muted">{model.description}</span>
                ) : null}
              </div>
            ))}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
