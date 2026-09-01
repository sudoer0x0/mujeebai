import { locales, defaultLocale, type AppLocale } from "@/i18n/routing";

/**
 * The language a visitor's country actually uses online.
 *
 * ## Why not just the country's official language
 *
 * Because they often differ, and the difference matters. Morocco, Algeria
 * and Tunisia all have Arabic as the official language, but French is the
 * administrative language and the one most business and web content is
 * written in — so a visitor from Casablanca is better served French than
 * Modern Standard Arabic. The same logic sends Senegal and Côte d'Ivoire
 * to French rather than to any of their national languages, and Brazil to
 * Portuguese rather than Spanish.
 *
 * ## Why not just Accept-Language
 *
 * Accept-Language is the better signal when it is present and meaningful,
 * and it is still consulted (see the resolver below). But it is frequently
 * just `en-US` because that is what the device shipped with, which tells
 * you about the phone rather than the person. The country is a second,
 * independent signal.
 *
 * ## Coverage
 *
 * This app ships seven locales. A country whose dominant online language
 * is not one of them falls back to English rather than to something
 * closer-but-wrong — a Kenyan visitor gets English, not Arabic.
 *
 * Sources consulted for the ambiguous cases (Maghreb, francophone and
 * lusophone Africa): Wikipedia's "Maghreb" and "North Africa" articles on
 * the administrative role of French alongside official Arabic.
 */

const COUNTRY_LOCALE: Record<string, AppLocale> = {
  // --- French ---------------------------------------------------------
  FR: "fr", BE: "fr", LU: "fr", MC: "fr",
  // Maghreb: Arabic is official, French is administrative and dominant
  // online. This is the case that motivated the whole map.
  MA: "fr", DZ: "fr", TN: "fr",
  // Francophone West and Central Africa.
  SN: "fr", CI: "fr", ML: "fr", BF: "fr", NE: "fr", TG: "fr", BJ: "fr",
  GN: "fr", CM: "fr", CD: "fr", CG: "fr", GA: "fr", TD: "fr", CF: "fr",
  MG: "fr", DJ: "fr", KM: "fr", BI: "fr", RW: "fr", HT: "fr", SC: "fr",

  // --- Arabic ---------------------------------------------------------
  SA: "ar", AE: "ar", EG: "ar", QA: "ar", KW: "ar", BH: "ar", OM: "ar",
  JO: "ar", IQ: "ar", LB: "ar", SY: "ar", YE: "ar", LY: "ar", SD: "ar",
  PS: "ar", MR: "ar",

  // --- Portuguese -----------------------------------------------------
  BR: "pt", PT: "pt", AO: "pt", MZ: "pt", CV: "pt", GW: "pt", ST: "pt", TL: "pt",

  // --- Spanish --------------------------------------------------------
  ES: "es", MX: "es", AR: "es", CO: "es", CL: "es", PE: "es", VE: "es",
  EC: "es", GT: "es", CU: "es", BO: "es", DO: "es", HN: "es", PY: "es",
  SV: "es", NI: "es", CR: "es", PA: "es", UY: "es", PR: "es", GQ: "es",

  // --- Japanese -------------------------------------------------------
  JP: "ja",

  // --- Chinese --------------------------------------------------------
  CN: "zh", TW: "zh", HK: "zh", MO: "zh",
  // Singapore is deliberately absent: its dominant online and
  // administrative language is English, not Chinese.
};

/**
 * Reads the visitor's country from whatever the platform provides.
 *
 * Vercel and Cloudflare each set their own header, and neither exists in
 * local development — which is why this returns null rather than
 * guessing, and the resolver falls through to Accept-Language.
 */
export function countryFromHeaders(headers: Headers): string | null {
  const country =
    headers.get("x-vercel-ip-country") ??
    headers.get("cf-ipcountry") ??
    headers.get("x-country-code");

  if (!country) return null;
  const code = country.trim().toUpperCase();
  // Cloudflare sends "XX" for anonymised or unknown clients.
  return /^[A-Z]{2}$/.test(code) && code !== "XX" && code !== "T1" ? code : null;
}

/** The app locale for a country code, or null if it maps to nothing we ship. */
export function localeForCountry(country: string | null): AppLocale | null {
  if (!country) return null;
  return COUNTRY_LOCALE[country.toUpperCase()] ?? null;
}

/** Parses Accept-Language into supported locales, best first. */
function fromAcceptLanguage(header: string | null): AppLocale | null {
  if (!header) return null;

  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q.split("=")[1]) || 0 : 1 };
    })
    .filter((entry) => entry.tag && entry.tag !== "*")
    .sort((a, b) => b.q - a.q);

  for (const { tag } of ranked) {
    // Match the base language: "pt-BR" and "pt-PT" both mean "pt" here.
    const base = tag.split("-")[0];
    if ((locales as readonly string[]).includes(base)) return base as AppLocale;
  }
  return null;
}

/**
 * The locale to use for a visitor who has not chosen one.
 *
 * Order:
 *   1. Country → its dominant online language (the requested behaviour)
 *   2. Accept-Language, when the country is unknown or maps to nothing we
 *      ship — this is what makes local development and VPN users sane
 *   3. English
 *
 * An explicit choice is *not* handled here: once a visitor picks a
 * language, next-intl's `MUJEEB_LOCALE` cookie carries it and this
 * function is never consulted again. That is what makes the choice stick
 * until they change it.
 */
export function resolveInitialLocale(headers: Headers): AppLocale {
  return (
    localeForCountry(countryFromHeaders(headers)) ??
    fromAcceptLanguage(headers.get("accept-language")) ??
    defaultLocale
  );
}
