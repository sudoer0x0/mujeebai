import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { LoginForm } from "./login-form";
import { getCurrentProfile } from "@/auth/session";
import { portalFor, type Role } from "@/admin/permissions";
import { Skeleton } from "@/components/ui/skeleton";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth.login" });
  return { title: t("title") };
}

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  // An already-signed-in visitor skips the form. Staff go to their
  // console rather than the chat app — see the note in (app)/layout.tsx.
  const profile = await getCurrentProfile();
  if (profile) {
    const portal = portalFor(profile.role as Role);
    redirect(`/${locale}${portal ?? "/chat"}`);
  }

  // The form reads `?next=` and `?error=`, so it needs a Suspense boundary
  // for `useSearchParams` during static rendering.
  return (
    <Suspense fallback={<Skeleton className="h-80 w-full" />}>
      <LoginForm />
    </Suspense>
  );
}
