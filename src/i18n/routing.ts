import { defineRouting } from "next-intl/routing";

// Supported application locales and default routing.
export const locales = ["en", "fr", "ar", "pt", "es", "ja", "zh"] as const;
export type AppLocale = (typeof locales)[number];

export const defaultLocale: AppLocale = "en";

export const rtlLocales: readonly AppLocale[] = ["ar"];

export const localeLabels: Record<AppLocale, string> = {
  en: "English",
  fr: "Français",
  ar: "العربية",
  pt: "Português",
  es: "Español",
  ja: "日本語",
  zh: "中文",
};

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: "always",
  localeCookie: {
    name: "MUJEEB_LOCALE",
  },
});
