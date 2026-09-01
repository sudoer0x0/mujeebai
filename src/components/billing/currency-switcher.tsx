"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, Coins } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { CURRENCY_LABELS, type SupportedCurrency } from "@/billing/currencies";
import { setCurrencyPreferenceAction } from "@/app/[locale]/currency-actions";
import { cn } from "@/lib/utils";

/**
 * Lets a visitor price the plans in their own currency.
 *
 * Rendered only when there is a real choice to make — a deployment that
 * has priced its plans in one currency gets no control at all, because a
 * dropdown with one option is a decision the reader has to process for
 * nothing.
 *
 * The switch is optimistic in appearance but authoritative on the server:
 * prices are rendered server-side from stored figures, so `router.refresh()`
 * is what actually repaints them. Nothing is converted in the browser —
 * there is no exchange rate anywhere in this feature, only prices an
 * operator typed.
 */
export function CurrencySwitcher({
  current,
  available,
  className,
}: {
  current: string;
  available: SupportedCurrency[];
  className?: string;
}) {
  const t = useTranslations("billing.currency");
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  if (available.length < 2) return null;

  function choose(currency: SupportedCurrency) {
    if (currency === current) return;
    startTransition(async () => {
      await setCurrencyPreferenceAction({ currency });
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* A bare currency code in a quiet button read as a label rather
            than something you could press. It now says what it does, wears
            a visible border, and carries the currency symbol — so "these
            prices are in NGN, and I can change that" is legible without
            hovering anything. */}
        <Button
          variant="outline"
          disabled={pending}
          aria-label={t("label")}
          className={cn("h-10 gap-2 px-3.5", className)}
        >
          <Coins className="size-4 opacity-70" aria-hidden />
          <span className="text-[13px] text-muted">{t("label")}</span>
          <span className="text-[14px] font-semibold tabular-nums text-foreground">{current}</span>
          <ChevronDown className="size-4 opacity-60" aria-hidden />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-[220px]">
        {available.map((code) => (
          <DropdownMenuItem key={code} onSelect={() => choose(code)}>
            <Check className={cn("size-3.5", code === current ? "opacity-100" : "opacity-0")} aria-hidden />
            <span className="font-medium tabular-nums">{code}</span>
            <span className="ms-1 truncate text-muted">{CURRENCY_LABELS[code]}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
