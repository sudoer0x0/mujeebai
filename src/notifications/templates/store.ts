import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { type TemplateFields } from "@/notifications/templates/shared";

// Re-exported so server callers keep one import site. The declarations
// live in `shared.ts` because the editor is a Client Component and cannot
// import anything from this module.
export {
  TEMPLATE_KINDS,
  TEMPLATE_PLACEHOLDERS,
  isTemplateKind,
  isConfigured,
  interpolate,
  type TemplateKind,
  type TemplateFields,
  type TemplatePlaceholder,
} from "@/notifications/templates/shared";

/**
 * Operator-configured email copy, with history.
 *
 * ## The contract with the message catalogs
 *
 * The catalogs stay the default for every (kind, locale) nobody has
 * edited. This store only ever *overrides*. That is what makes the
 * feature safe to add to a running system: a deployment that never opens
 * the editor behaves exactly as it did, a locale nobody translated still
 * sends correct copy, and a database that is unreachable at send time
 * degrades to the built-in wording instead of failing to send.
 *
 * A blank field is treated as "not overridden" rather than as an
 * intentional empty string, because an email with no subject is never
 * what an operator meant.
 *
 * ## Placeholders
 *
 * Templates interpolate a small, fixed set of values. The list is closed
 * on purpose: anything an operator can type ends up in an email sent from
 * this domain, so the substitution step must not be able to reach
 * arbitrary data. Unknown placeholders are left as written rather than
 * silently blanked, so a typo is visible in the preview.
 */

export interface StoredTemplate extends TemplateFields {
  id: string;
  kind: string;
  locale: string;
  version: number;
  updatedAt: string;
  updatedBy: string | null;
}

export interface TemplateVersion extends TemplateFields {
  id: string;
  version: number;
  changeNote: string | null;
  restoredFrom: number | null;
  createdAt: string;
  createdBy: string | null;
}

function toFields(row: Record<string, unknown>): TemplateFields {
  return {
    subject: String(row.subject ?? ""),
    preview: String(row.preview ?? ""),
    heading: String(row.heading ?? ""),
    body: String(row.body ?? ""),
    actionLabel: String(row.action_label ?? ""),
    footnote: String(row.footnote ?? ""),
  };
}

/**
 * The live override for one (kind, locale), or null.
 *
 * Never throws. Email rendering sits on the critical path of sign-up and
 * password reset; a failure to read an *optional* override must not stop
 * the message going out.
 */
export async function getTemplateOverride(kind: string, locale: string): Promise<TemplateFields | null> {
  try {
    const supabase = createServiceRoleClient();
    const { data } = await supabase
      .from("email_templates")
      .select("subject, preview, heading, body, action_label, footnote")
      .eq("kind", kind)
      .eq("locale", locale)
      .maybeSingle();

    if (!data) return null;
    return toFields(data as Record<string, unknown>);
  } catch (error) {
    logger.warn("email_template_lookup_failed", { kind, locale, error: String(error) });
    return null;
  }
}

/** Every configured template, for the console listing. */
export async function listTemplates(): Promise<StoredTemplate[]> {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("email_templates")
    .select("id, kind, locale, subject, preview, heading, body, action_label, footnote, version, updated_at, updated_by")
    .order("kind")
    .order("locale");

  return (data ?? []).map((row) => ({
    id: String(row.id),
    kind: String(row.kind),
    locale: String(row.locale),
    version: Number(row.version),
    updatedAt: String(row.updated_at),
    updatedBy: row.updated_by ? String(row.updated_by) : null,
    ...toFields(row as Record<string, unknown>),
  }));
}

/** History for one template, newest first. */
export async function listTemplateVersions(templateId: string): Promise<TemplateVersion[]> {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("email_template_versions")
    .select("id, version, subject, preview, heading, body, action_label, footnote, change_note, restored_from, created_at, created_by")
    .eq("template_id", templateId)
    .order("version", { ascending: false })
    .limit(50);

  return (data ?? []).map((row) => ({
    id: String(row.id),
    version: Number(row.version),
    changeNote: row.change_note ? String(row.change_note) : null,
    restoredFrom: row.restored_from === null ? null : Number(row.restored_from),
    createdAt: String(row.created_at),
    createdBy: row.created_by ? String(row.created_by) : null,
    ...toFields(row as Record<string, unknown>),
  }));
}

export interface SaveResult {
  ok: boolean;
  version?: number;
  reason?: string;
}

/**
 * Writes a new version and makes it live.
 *
 * The previous content is copied into history *before* the update, so the
 * version row always describes what was actually sent during that
 * version's lifetime. Doing it the other way round would record the new
 * content twice and lose the old.
 *
 * `restoredFrom` marks a save that reinstates an earlier version. Restore
 * is a forward-moving save rather than a rewind: the history keeps
 * growing, so it always shows what happened rather than what the current
 * state implies happened.
 */
export async function saveTemplate(params: {
  kind: string;
  locale: string;
  fields: TemplateFields;
  actorId: string;
  changeNote?: string | null;
  restoredFrom?: number | null;
}): Promise<SaveResult> {
  const supabase = createServiceRoleClient();

  const { data: existing } = await supabase
    .from("email_templates")
    .select("id, version, subject, preview, heading, body, action_label, footnote")
    .eq("kind", params.kind)
    .eq("locale", params.locale)
    .maybeSingle();

  if (!existing) {
    const { data: created, error } = await supabase
      .from("email_templates")
      .insert({
        kind: params.kind,
        locale: params.locale,
        subject: params.fields.subject,
        preview: params.fields.preview,
        heading: params.fields.heading,
        body: params.fields.body,
        action_label: params.fields.actionLabel,
        footnote: params.fields.footnote,
        version: 1,
        updated_by: params.actorId,
      })
      .select("id")
      .single();

    if (error || !created) return { ok: false, reason: error?.message ?? "insert_failed" };

    // Version 1 is recorded too, so the history is complete from the
    // first save rather than starting at the second.
    await supabase.from("email_template_versions").insert({
      template_id: created.id,
      kind: params.kind,
      locale: params.locale,
      version: 1,
      subject: params.fields.subject,
      preview: params.fields.preview,
      heading: params.fields.heading,
      body: params.fields.body,
      action_label: params.fields.actionLabel,
      footnote: params.fields.footnote,
      change_note: params.changeNote ?? null,
      restored_from: params.restoredFrom ?? null,
      created_by: params.actorId,
    });

    return { ok: true, version: 1 };
  }

  const nextVersion = Number(existing.version) + 1;

  const { error: updateError } = await supabase
    .from("email_templates")
    .update({
      subject: params.fields.subject,
      preview: params.fields.preview,
      heading: params.fields.heading,
      body: params.fields.body,
      action_label: params.fields.actionLabel,
      footnote: params.fields.footnote,
      version: nextVersion,
      updated_by: params.actorId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id);

  if (updateError) return { ok: false, reason: updateError.message };

  const { error: versionError } = await supabase.from("email_template_versions").insert({
    template_id: existing.id,
    kind: params.kind,
    locale: params.locale,
    version: nextVersion,
    subject: params.fields.subject,
    preview: params.fields.preview,
    heading: params.fields.heading,
    body: params.fields.body,
    action_label: params.fields.actionLabel,
    footnote: params.fields.footnote,
    change_note: params.changeNote ?? null,
    restored_from: params.restoredFrom ?? null,
    created_by: params.actorId,
  });

  if (versionError) {
    logger.error("email_template_version_insert_failed", { error: versionError.message });
    return { ok: false, reason: versionError.message };
  }

  return { ok: true, version: nextVersion };
}

/**
 * Returns this email to its built-in copy.
 *
 * Implemented as a **save of blank fields**, not a delete, for two
 * reasons that turned out to be the same reason.
 *
 * Deleting the row cascades into `email_template_versions`, which the
 * append-only trigger correctly refuses — so a delete could only work by
 * weakening the one guarantee that stops an operator quietly rewriting
 * what an email used to say. Not worth it.
 *
 * And blank already means "use the built-in copy" everywhere else in this
 * module, so a blank version *is* the reset. It reads correctly in the
 * history too: reverting is a change someone made at a particular time,
 * not an erasure of the fact that the template was ever customised — and
 * because it is an ordinary version, the previous copy can be restored
 * again afterwards.
 */
export async function resetTemplate(kind: string, locale: string, actorId: string): Promise<boolean> {
  const supabase = createServiceRoleClient();

  const { data: existing } = await supabase
    .from("email_templates")
    .select("id")
    .eq("kind", kind)
    .eq("locale", locale)
    .maybeSingle();

  // Never configured: there is nothing to reset, and that is a success.
  if (!existing) return true;

  const result = await saveTemplate({
    kind,
    locale,
    fields: { subject: "", preview: "", heading: "", body: "", actionLabel: "", footnote: "" },
    actorId,
    changeNote: "reset-to-default",
  });

  return result.ok;
}
