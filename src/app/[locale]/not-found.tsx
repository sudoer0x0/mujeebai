import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

export default async function NotFound() {
  const t = await getTranslations("errors");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-2xl font-semibold">{t("notFound.title")}</h1>
      <p className="text-muted">{t("notFound.body")}</p>
      <Button asChild className="mt-2">
        <Link href="/">Home</Link>
      </Button>
    </div>
  );
}
