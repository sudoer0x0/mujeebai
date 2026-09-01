import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { ShieldCheck, Shield } from "lucide-react";

/**
 * Chrome for the staff entrance.
 *
 * Deliberately not the customer auth layout. There is no product
 * branding, no language switcher, no "create account" path and no link
 * back into the app — an operator arriving here is signing in to
 * administer the platform, not to use it, and the surface should say so
 * before they type anything.
 *
 * It also says *which* console it guards. The two consoles have separate
 * secret entrances, and a page that reads "Staff access" at both gives an
 * operator no way to tell which one they opened — which is exactly the
 * confusion that made a wrong-entrance sign-in hard to diagnose.
 *
 * The area comes from a request header the middleware sets from the
 * secret the request arrived through. It is never read from the URL in
 * the browser and never accepted from the client: the middleware deletes
 * any inbound `x-portal-area` before setting its own.
 */
export default async function StaffAuthLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  // The locale is taken from the route and passed explicitly, as every
  // other layout under [locale] does. Calling `getTranslations()` without
  // it relies on a request-scoped locale this layout never establishes —
  // it does not call `setRequestLocale` — which is fragile in a layout
  // that is already dynamic because it reads headers.
  const { locale } = await params;
  const requestHeaders = await headers();
  // Absent means the consoles share one entrance (no secrets configured),
  // in which case naming one of them would be a lie.
  const reported = requestHeaders.get("x-portal-area");
  const area = reported === "admin" ? "admin" : reported === "staff" ? "staff" : null;
  const t = await getTranslations({ locale, namespace: "staffAuth.portal" });

  const Icon = area === "admin" ? ShieldCheck : Shield;

  return (
    <div className="flex min-h-dvh flex-col bg-surface-sunken">
      <main
        id="main"
        className="flex flex-1 items-center justify-center px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-10"
      >
        <div className="w-full max-w-sm">
          <div className="mb-6 flex items-center gap-2.5">
            <div
              className={
                area === "admin"
                  ? "flex size-8 items-center justify-center rounded-md border border-accent/50 bg-accent-soft"
                  : "flex size-8 items-center justify-center rounded-md border border-line-strong bg-surface"
              }
            >
              <Icon className={area === "admin" ? "size-4 text-accent" : "size-4 text-muted"} aria-hidden />
            </div>
            <div>
              <p className="text-[13px] font-semibold tracking-tight text-foreground">Mujeeb AI</p>
              <p className="text-[11px] uppercase tracking-wide text-faint">
                {area === "admin" ? t("adminEntrance") : area === "staff" ? t("staffEntrance") : t("sharedEntrance")}
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-line bg-surface p-5">{children}</div>
        </div>
      </main>
    </div>
  );
}
