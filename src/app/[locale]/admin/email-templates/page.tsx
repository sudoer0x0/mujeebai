import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireSuperAdminPage } from "@/auth/session";
import { assertPermission } from "@/admin/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmailTemplateEditor } from "@/components/staff/email-template-editor";
import {
  TEMPLATE_KINDS,
  isTemplateKind,
  listTemplates,
  listTemplateVersions,
  isConfigured,
} from "@/notifications/templates/store";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { routing } from "@/i18n/routing";

/**
 * Configuring the transactional emails.
 *
 * The shipped translations are loaded alongside whatever override exists
 * and passed down as *placeholders*, so the editor can show what will
 * actually be sent for any field left blank. That is what makes partial
 * overrides usable: change the subject for one locale and the other six
 * keep their correct translations rather than silently inheriting English.
 */
export default async function EmailTemplatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ kind?: string; locale?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const profile = await requireSuperAdminPage(locale);
  assertPermission(profile, "email_templates.view");

  const t = await getTranslations({ locale, namespace: "admin.emailTemplates" });
  const query = await searchParams;

  const kind = query.kind && isTemplateKind(query.kind) ? query.kind : TEMPLATE_KINDS[0];
  const targetLocale = routing.locales.includes(query.locale as (typeof routing.locales)[number])
    ? (query.locale as string)
    : locale;

  const configured = await listTemplates();
  const current = configured.find((entry) => entry.kind === kind && entry.locale === targetLocale) ?? null;

  // The shipped copy for this exact (kind, locale) — shown as the
  // placeholder for every field the operator has not overridden.
  const td = await getTranslations({ locale: targetLocale, namespace: `emails.${kind}` });
  const tcommon = await getTranslations({ locale: targetLocale, namespace: "emails.common" });
  const defaults = {
    subject: td("subject"),
    preview: td("preview"),
    heading: td("heading"),
    body: td("body"),
    actionLabel: kind === "welcome" ? tcommon("openApp") : td("action"),
    footnote: td("footnote"),
  };

  const rawVersions = current ? await listTemplateVersions(current.id) : [];

  // One lookup for every author on the page rather than one per row.
  const authorIds = Array.from(new Set(rawVersions.map((v) => v.createdBy).filter(Boolean) as string[]));
  const supabase = createServiceRoleClient();
  const { data: authors } = authorIds.length
    ? await supabase.from("profiles").select("id, email, display_name").in("id", authorIds)
    : { data: [] };
  const authorName = new Map((authors ?? []).map((a) => [a.id, a.display_name || a.email || a.id]));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("title")} description={t("description")} />

      <Card>
        <CardContent className="p-4 sm:p-5">
          <EmailTemplateEditor
            kinds={[...TEMPLATE_KINDS]}
            locales={[...routing.locales]}
            defaults={defaults}
            template={{
              kind,
              locale: targetLocale,
              subject: current?.subject ?? "",
              preview: current?.preview ?? "",
              heading: current?.heading ?? "",
              body: current?.body ?? "",
              actionLabel: current?.actionLabel ?? "",
              footnote: current?.footnote ?? "",
              version: current?.version ?? 0,
              // A row can exist and still override nothing — "reset to
              // default" saves a blank version rather than deleting, so
              // presence of a row is not the same as being configured.
              configured: current ? isConfigured(current) : false,
            }}
            versions={rawVersions.map((v) => ({
              version: v.version,
              subject: v.subject,
              heading: v.heading,
              body: v.body,
              changeNote: v.changeNote,
              restoredFrom: v.restoredFrom,
              createdAt: v.createdAt,
              authorName: v.createdBy ? (authorName.get(v.createdBy) ?? null) : null,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
