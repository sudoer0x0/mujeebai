import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireSuperAdminPage } from "@/auth/session";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { PromptEditor } from "@/components/staff/prompt-editor";

export default async function AdminSystemPromptPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireSuperAdminPage(locale);

  const t = await getTranslations({ locale, namespace: "admin.systemPrompt" });

  const supabase = createServiceRoleClient();
  const { data: versions } = await supabase
    .from("system_prompt_versions")
    .select("id, version, content, status, created_at, published_at, created_by")
    .order("version", { ascending: false })
    .limit(25);

  const authorIds = Array.from(new Set((versions ?? []).map((v) => v.created_by).filter(Boolean) as string[]));
  const { data: authors } = authorIds.length
    ? await supabase.from("profiles").select("id, email, display_name").in("id", authorIds)
    : { data: [] };
  const authorName = new Map((authors ?? []).map((a) => [a.id, a.display_name || a.email || a.id]));

  const active = (versions ?? []).find((version) => version.status === "active");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("title")} description={t("description")} />
      <PromptEditor
        locale={locale}
        activeVersion={active?.version ?? 0}
        initialContent={active?.content ?? ""}
        history={(versions ?? []).map((version) => ({
          id: version.id,
          version: version.version,
          status: version.status,
          createdAt: version.created_at,
          publishedAt: version.published_at,
          author: version.created_by ? (authorName.get(version.created_by) ?? null) : null,
          preview: version.content.slice(0, 160),
        }))}
      />
    </div>
  );
}
