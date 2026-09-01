import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind class lists safely (used by every UI primitive). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Locales that require right-to-left layout. */
export const RTL_LOCALES = new Set(["ar"]);

export function isRtlLocale(locale: string) {
  return RTL_LOCALES.has(locale);
}



