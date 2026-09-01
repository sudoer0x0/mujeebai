import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { clientEnv } from "@/lib/env";
import { routing } from "@/i18n/routing";
import { isRtlLocale } from "@/lib/utils";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { ToastProvider } from "@/components/ui/toast";
import "../globals.css";
import { ServiceWorkerRegistration } from "@/components/app/service-worker";

// Intentionally not using `next/font/google`: fetching a webfont at build
// time makes the build itself depend on network access to Google's font
// CDN, which fails in network-restricted build environments (and is one
// more third-party dependency for no real typographic gain over a system
// font stack). `globals.css`'s `--font-sans`/`--font-mono` already fall
// back to `ui-sans-serif`/`ui-monospace`/system-ui — if you want a bundled
// custom font later, add it via `next/font/local` with a font file checked
// into the repo, which has no build-time network dependency either.

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata" });
  return {
    // Absolute URLs for anything shared or crawled. Without a metadataBase
    // Next resolves Open Graph images against localhost, which is what
    // ships in the preview card if it is forgotten.
    metadataBase: new URL(clientEnv.NEXT_PUBLIC_SITE_URL),
    title: { default: t("title"), template: `%s · ${t("title")}` },
    description: t("description"),
    manifest: "/manifest.webmanifest",
    applicationName: clientEnv.NEXT_PUBLIC_APP_NAME,
    // iOS ignores the manifest for standalone mode and reads these
    // instead, so a home-screen launch without them opens in Safari
    // chrome rather than as an app.
    appleWebApp: {
      capable: true,
      title: clientEnv.NEXT_PUBLIC_APP_NAME,
      statusBarStyle: "black-translucent",
    },
    icons: {
      icon: [
        { url: "/favicon.ico", sizes: "any" },
        { url: "/favicon.svg", type: "image/svg+xml" },
        { url: "/icons/favicon-32x32.png", sizes: "32x32", type: "image/png" },
        { url: "/icons/favicon-16x16.png", sizes: "16x16", type: "image/png" },
        { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      ],
      apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
    },
    openGraph: {
      type: "website",
      siteName: clientEnv.NEXT_PUBLIC_APP_NAME,
      title: t("title"),
      description: t("description"),
    },
    twitter: { card: "summary_large_image", title: t("title"), description: t("description") },
    // A staff console behind a secret path must not be indexed, and the
    // marketing pages set their own robots rules where they differ.
    formatDetection: { telephone: false },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    notFound();
  }

  setRequestLocale(locale);
  const messages = await getMessages();
  const dir = isRtlLocale(locale) ? "rtl" : "ltr";

  return (
    // `data-font` is set by /theme-init.js before first paint, from the
    // MUJEEB_FONT cookie — not read here.
    //
    // It used to be read from the profile in this layout, which was a
    // mistake: this layout exports `generateStaticParams`, and Next
    // evaluates that in a separate worker process. Pulling Supabase into
    // that module graph made the worker fail with "Cannot find module
    // './vendor-chunks/@supabase.js'" on every page load. Reading the
    // cookie here instead would have worked but forced every route —
    // including the marketing pages — to render dynamically.
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#0e0f11" />
        {/* A plain <script src> rather than next/script: it must run
            before first paint to avoid a light/dark flash, which is
            exactly what a synchronous script in <head> does, and it
            sidesteps next/script's `beforeInteractive` strategy (root
            layout only, and the source of a nonce hydration mismatch).

            No `nonce` attribute on purpose. It is a same-origin external
            script, so `script-src 'self'` already permits it, and a
            per-request nonce rendered into the tree can never match on
            re-render. See src/lib/csp.ts. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts --
            Blocking is the entire point: this sets the theme class before
            first paint, and any async/deferred strategy produces a
            visible light-then-dark flash on every load. The file is tiny
            and same-origin, so the parser stall is negligible. */}
        <script src="/theme-init.js" />
      </head>
      <body className="min-h-screen antialiased bg-canvas text-foreground">
        <NextIntlClientProvider messages={messages} locale={locale}>
          <ThemeProvider>
            <ServiceWorkerRegistration />
            <ToastProvider>{children}</ToastProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
