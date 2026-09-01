import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { RegisterForm } from "./register-form";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { getCurrentUser } from "@/auth/session";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth.register" });
  return { title: t("title") };
}

export default async function RegisterPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Already signed in? Sending someone to a sign-up form they cannot use
  // is a dead end.
  const user = await getCurrentUser();
  if (user) redirect(`/${locale}/chat`);

  const t = await getTranslations({ locale, namespace: "auth" });

  // The same flag the sign-up action enforces server-side. Hiding the form
  // is the courtesy; the action is the control.
  if (!(await isFeatureEnabled("registration"))) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="info" title={t("register.title")}>
          {t("errors.registrationClosed")}
        </Alert>
        <Button variant="outline" asChild>
          <Link href="/login">{t("backToLogin")}</Link>
        </Button>
      </div>
    );
  }

  return <RegisterForm />;
}
