import { staffPortalHref } from "@/auth/portal-path";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Users, ShieldOff, MailQuestion, Activity } from "lucide-react";
import { requireStaffPage } from "@/auth/session";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/card";

export default async function ModeratorDashboard({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const moderator = await requireStaffPage(locale);
  const t = await getTranslations({ locale, namespace: "moderator.dashboard" });

  const supabase = createServiceRoleClient();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Head-only counts: these tiles need the number, not the rows, and
  // pulling every profile to call .length on it is how a dashboard becomes
  // the slowest page in an admin console.
  const [total, suspended, pending, actions] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "user"),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("status", "suspended"),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("status", "pending_verification"),
    supabase
      .from("moderation_records")
      .select("id", { count: "exact", head: true })
      .eq("performed_by", moderator.id)
      .gte("created_at", weekAgo),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("title")} description={t("description")} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label={t("totalAccounts")} value={(total.count ?? 0).toLocaleString(locale)} />
        <StatTile label={t("suspended")} value={(suspended.count ?? 0).toLocaleString(locale)} />
        <StatTile label={t("pending")} value={(pending.count ?? 0).toLocaleString(locale)} />
        <StatTile label={t("actions7d")} value={(actions.count ?? 0).toLocaleString(locale)} />
      </div>

      {/* Being explicit about the boundary is kinder than letting someone
          discover it by hitting a redirect. */}

      <div className="grid gap-3 sm:grid-cols-2">
        <QuickLink icon={Users} labelKey="nav.users" href={staffPortalHref("/moderator/users")} locale={locale} />
        <QuickLink icon={ShieldOff} labelKey="nav.moderation" href={staffPortalHref("/moderator/moderation")} locale={locale} />
      </div>
    </div>
  );
}

async function QuickLink({
  icon: Icon,
  labelKey,
  href,
  locale,
}: {
  icon: typeof Users | typeof ShieldOff | typeof MailQuestion | typeof Activity;
  labelKey: string;
  href: string;
  locale: string;
}) {
  const t = await getTranslations({ locale, namespace: "moderator" });
  const { Link } = await import("@/i18n/navigation");
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 transition-colors hover:border-line-strong hover:bg-surface-raised"
    >
      <Icon className="size-4 text-muted" aria-hidden />
      <span className="text-[13px] font-medium text-foreground">{t(labelKey as never)}</span>
    </Link>
  );
}
