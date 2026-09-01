import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth.verify" });
  return { title: t("title") };
}

export default async function VerifyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "auth" });

  return (
    <div className="flex flex-col gap-5 text-center">
      <div className="mx-auto flex size-10 items-center justify-center rounded-md border border-line bg-surface-raised">
        <Mail className="size-4 text-muted" aria-hidden />
      </div>
      <div>
        <h1 className="text-[17px] font-semibold tracking-tight text-foreground">{t("verify.title")}</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{t("magicLink.sent")}</p>
      </div>
      <Button variant="outline" asChild>
        <Link href="/login">{t("backToLogin")}</Link>
      </Button>
    </div>
  );
}
