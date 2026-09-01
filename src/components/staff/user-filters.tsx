"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * Search and filter controls for the account tables.
 *
 * State lives in the URL rather than in component state, so a filtered
 * view is linkable, survives a refresh, and works with the browser's back
 * button. Submitting resets to page 1 — staying on page 4 of a different
 * result set is a classic way to show an operator an empty table and let
 * them conclude the search found nothing.
 */
export function UserFilters({ showRoleFilter = true }: { showRoleFilter?: boolean }) {
  const t = useTranslations("admin.users");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [query, setQuery] = React.useState(params.get("q") ?? "");

  function apply(next: Record<string, string | undefined>) {
    const search = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (!value || value === "all") search.delete(key);
      else search.set(key, value);
    }
    search.delete("page");
    const queryString = search.toString();
    router.push(queryString ? `${pathname}?${queryString}` : pathname);
  }

  return (
    <form
      className="flex flex-col gap-2 sm:flex-row sm:items-center"
      onSubmit={(event) => {
        event.preventDefault();
        apply({ q: query.trim() || undefined });
      }}
    >
      <div className="relative flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" aria-hidden />
        <Input
          name="q"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("searchPlaceholder")}
          aria-label={t("search")}
          className="ps-8"
        />
      </div>

      {showRoleFilter ? (
        <Select defaultValue={params.get("role") ?? "all"} onValueChange={(value) => apply({ role: value })}>
          <SelectTrigger className="sm:w-40" aria-label={t("filterRole")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filterRole")}: {t("all")}</SelectItem>
            <SelectItem value="user">User</SelectItem>
            <SelectItem value="moderator">Moderator</SelectItem>
            <SelectItem value="super_admin">Super Admin</SelectItem>
          </SelectContent>
        </Select>
      ) : null}

      <Select defaultValue={params.get("status") ?? "all"} onValueChange={(value) => apply({ status: value })}>
        <SelectTrigger className="sm:w-44" aria-label={t("filterStatus")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("filterStatus")}: {t("all")}</SelectItem>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="suspended">Suspended</SelectItem>
          <SelectItem value="disabled">Disabled</SelectItem>
          <SelectItem value="pending_verification">Pending verification</SelectItem>
        </SelectContent>
      </Select>

      <Button type="submit" variant="secondary">
        {t("search")}
      </Button>
    </form>
  );
}
