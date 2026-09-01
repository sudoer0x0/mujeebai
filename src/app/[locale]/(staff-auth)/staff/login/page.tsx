import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getCurrentProfile } from "@/auth/session";
import { portalFor, type Role } from "@/admin/permissions";
import { staffGateStatus } from "@/auth/staff-gate";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { StaffLoginForm } from "./staff-login-form";
import { Skeleton } from "@/components/ui/skeleton";
import { staffPortalHref } from "@/auth/portal-path";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "staffAuth" });
  return {
    title: t("title"),
    // A staff sign-in page has no business in a search index.
    robots: { index: false, follow: false },
  };
}

export default async function StaffLoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Already signed in as staff *and* past the gate? Go straight to the
  // right console.
  //
  // The gate check is what stops a redirect loop. This shortcut used to
  // fire for any authenticated staff session, including one that had not
  // been stepped up with an authenticator — so the console bounced it here
  // for a code, and this page bounced it straight back to the console.
  // Neither page rendered; the operator saw an empty card.
  //
  // When the gate is not satisfied, fall through and let the form decide:
  // it reads `?step=mfa` and asks for the code.
  const profile = await getCurrentProfile();
  if (profile && profile.status === "active") {
    const portal = portalFor(profile.role as Role);
    if (portal && (await staffGateStatus(profile)) === "ok") {
      redirect(staffPortalHref(portal, locale));
    }
  }

  // The factor to challenge, resolved here for the step-up path — an
  // operator arriving with `?step=mfa` already has a session, but no
  // sign-in response to carry the id. Doing it server-side on both paths
  // means the browser never has to find the factor itself, which is what
  // was failing and being misreported as "no authenticator is set up".
  let mfaFactorId: string | undefined;
  if (profile && profile.status === "active") {
    const supabase = await createServerSupabaseClient();
    const { data: factors } = await supabase.auth.mfa.listFactors();
    mfaFactorId = (factors?.totp ?? []).find((factor: { status: string }) => factor.status === "verified")?.id;
  }

  return (
    <Suspense fallback={<Skeleton className="h-72 w-full" />}>
      <StaffLoginForm stepUpFactorId={mfaFactorId} />
    </Suspense>
  );
}
