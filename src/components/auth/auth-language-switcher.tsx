"use client";

import * as React from "react";
import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { locales, localeLabels, type AppLocale } from "@/i18n/routing";
import { Globe } from "lucide-react";

export function AuthLanguageSwitcher() {
  const currentLocale = useLocale() as AppLocale;
  const router = useRouter();
  const pathname = usePathname();

  function onSelectLocale(e: React.ChangeEvent<HTMLSelectElement>) {
    const nextLocale = e.target.value as AppLocale;
    router.replace(pathname, { locale: nextLocale });
  }

  return (
    <div className="relative inline-flex items-center text-xs text-muted hover:text-foreground transition-colors">
      <Globe className="h-3.5 w-3.5 mr-1.5 rtl:mr-0 rtl:ml-1.5 pointer-events-none text-muted" />
      <select
        value={currentLocale}
        onChange={onSelectLocale}
        className="bg-transparent border border-line/60 hover:border-line rounded-lg px-2 py-1 pr-6 rtl:pr-2 rtl:pl-6 text-xs text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-focus appearance-none uppercase font-medium"
      >
        {locales.map((loc) => (
          <option key={loc} value={loc} className="bg-surface text-foreground">
            {loc.toUpperCase()} — {localeLabels[loc]}
          </option>
        ))}
      </select>
      <span className="absolute right-2 rtl:right-auto rtl:left-2 top-1/2 -translate-y-1/2 pointer-events-none text-[10px] text-muted">
        ▾
      </span>
    </div>
  );
}
