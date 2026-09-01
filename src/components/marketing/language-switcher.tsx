"use client";

import { useLocale, useTranslations } from "next-intl";
import { Languages, Check } from "lucide-react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { locales, localeLabels } from "@/i18n/routing";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

export function LanguageSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("common");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* Was an unlabelled icon. An icon alone does not say *which*
            language is active, which is the one thing a reader scanning
            for their own language needs to know. The code is shown from
            the `sm` breakpoint up; on a phone the icon keeps the header
            from wrapping. */}
        <Button variant="ghost" size="sm" aria-label={t("language")} className="h-9 gap-1.5 px-2.5">
          <Languages className="size-[18px]" />
          <span className="hidden text-[14px] font-medium uppercase sm:inline">{locale}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {locales.map((value) => (
          <DropdownMenuItem
            key={value}
            // `replace` keeps the current page, so switching language
            // never bounces the reader back to the home page.
            onSelect={() => router.replace(pathname, { locale: value })}
            lang={value}
          >
            <span className="flex-1">{localeLabels[value]}</span>
            {value === locale ? <Check className="size-3.5 text-accent" aria-hidden /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
