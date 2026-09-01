"use client";

import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";

/** Page controls that keep the current filters in the URL. */
export function Pagination({ page, pageSize, total }: { page: number; pageSize: number; total: number }) {
  const t = useTranslations("admin.users");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  function goTo(nextPage: number) {
    const search = new URLSearchParams(params.toString());
    if (nextPage <= 1) search.delete("page");
    else search.set("page", String(nextPage));
    const queryString = search.toString();
    router.push(queryString ? `${pathname}?${queryString}` : pathname);
  }

  if (total === 0) return null;

  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-[12px] text-muted tabular-nums">{t("showing", { from, to, total })}</p>
      <div className="flex items-center gap-1.5">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => goTo(page - 1)}>
          <ChevronLeft className="rtl:rotate-180" />
          {t("previous")}
        </Button>
        <Button variant="secondary" size="sm" disabled={page >= lastPage} onClick={() => goTo(page + 1)}>
          {t("next")}
          <ChevronRight className="rtl:rotate-180" />
        </Button>
      </div>
    </div>
  );
}
