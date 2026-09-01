import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { UpdatePasswordForm } from "./update-form";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth.updatePassword" });
  return { title: t("title") };
}

export default async function UpdatePasswordPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <UpdatePasswordForm />;
}
