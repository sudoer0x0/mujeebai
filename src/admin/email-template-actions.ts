"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff, ForbiddenError } from "@/auth/session";
import { assertPermission } from "@/admin/permissions";
import { recordAuditEvent } from "@/admin/audit";
import { routing } from "@/i18n/routing";
import {
  TEMPLATE_KINDS,
  saveTemplate,
  resetTemplate,
  listTemplateVersions,
} from "@/notifications/templates/store";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import type { ActionResponse } from "@/admin/user-actions";

/**
 * Editing the transactional emails.
 *
 * Every action here is `email_templates.manage`, which is super admin
 * only. The reasoning is in the permission matrix: this is the copy the
 * platform sends from its own domain, and a bad edit is indistinguishable
 * from a phishing email because the headers are genuine.
 *
 * Length caps exist so a single template cannot be turned into a payload:
 * an email body is prose, and nothing legitimate needs 100KB of it.
 */

const fieldsSchema = z.object({
  kind: z.enum(TEMPLATE_KINDS),
  locale: z.enum(routing.locales),
  subject: z.string().trim().max(200),
  preview: z.string().trim().max(200),
  heading: z.string().trim().max(200),
  body: z.string().trim().max(4000),
  actionLabel: z.string().trim().max(80),
  footnote: z.string().trim().max(600),
  changeNote: z.string().trim().max(200).optional(),
});

export async function saveEmailTemplateAction(input: unknown): Promise<ActionResponse & { version?: number }> {
  try {
    const actor = await requireStaff();
    assertPermission(actor, "email_templates.manage");

    const parsed = fieldsSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "admin.emailTemplates.invalid" };

    const { kind, locale, changeNote, ...fields } = parsed.data;

    // A template with nothing in it is not an override, it is a mistake.
    // Refuse rather than quietly sending an email with a blank subject.
    if (!fields.subject && !fields.heading && !fields.body) {
      return { ok: false, message: "admin.emailTemplates.empty" };
    }

    const result = await saveTemplate({
      kind,
      locale,
      fields,
      actorId: actor.id,
      changeNote: changeNote ?? null,
    });

    await recordAuditEvent({
      actorId: actor.id,
      action: "admin.email_template_saved",
      targetType: "email_template",
      targetId: `${kind}:${locale}`,
      result: result.ok ? "success" : "failure",
      // The copy itself is deliberately not in the audit metadata: the
      // full text of every version already lives in
      // `email_template_versions`, and duplicating it here would double
      // the storage and give two places to disagree.
      metadata: { kind, locale, version: result.version ?? null },
    });

    if (!result.ok) return { ok: false, message: "admin.emailTemplates.failed" };

    revalidatePath("/admin/email-templates");
    return { ok: true, message: "admin.emailTemplates.saved", version: result.version };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: "admin.common.notPermitted" };
    logger.error("email_template_save_failed", { error: String(error) });
    return { ok: false, message: "admin.emailTemplates.failed" };
  }
}

const restoreSchema = z.object({
  kind: z.enum(TEMPLATE_KINDS),
  locale: z.enum(routing.locales),
  version: z.number().int().positive(),
});

/**
 * Reinstates an earlier version.
 *
 * Implemented as a *new* save carrying the old content, not as a rewind.
 * The history therefore keeps growing and shows that a restore happened,
 * which also means a restore can itself be undone by restoring again —
 * the same reasoning that makes `admin_audit_logs` append-only.
 */
export async function restoreEmailTemplateAction(input: unknown): Promise<ActionResponse & { version?: number }> {
  try {
    const actor = await requireStaff();
    assertPermission(actor, "email_templates.manage");

    const parsed = restoreSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "admin.emailTemplates.invalid" };

    const supabase = createServiceRoleClient();
    const { data: template } = await supabase
      .from("email_templates")
      .select("id")
      .eq("kind", parsed.data.kind)
      .eq("locale", parsed.data.locale)
      .maybeSingle();

    if (!template) return { ok: false, message: "admin.emailTemplates.notFound" };

    const versions = await listTemplateVersions(template.id);
    const target = versions.find((entry) => entry.version === parsed.data.version);
    if (!target) return { ok: false, message: "admin.emailTemplates.versionNotFound" };

    const result = await saveTemplate({
      kind: parsed.data.kind,
      locale: parsed.data.locale,
      fields: {
        subject: target.subject,
        preview: target.preview,
        heading: target.heading,
        body: target.body,
        actionLabel: target.actionLabel,
        footnote: target.footnote,
      },
      actorId: actor.id,
      restoredFrom: target.version,
    });

    await recordAuditEvent({
      actorId: actor.id,
      action: "admin.email_template_restored",
      targetType: "email_template",
      targetId: `${parsed.data.kind}:${parsed.data.locale}`,
      result: result.ok ? "success" : "failure",
      metadata: { restoredFrom: target.version, newVersion: result.version ?? null },
    });

    if (!result.ok) return { ok: false, message: "admin.emailTemplates.failed" };

    revalidatePath("/admin/email-templates");
    return { ok: true, message: "admin.emailTemplates.restored", version: result.version };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: "admin.common.notPermitted" };
    logger.error("email_template_restore_failed", { error: String(error) });
    return { ok: false, message: "admin.emailTemplates.failed" };
  }
}

const resetSchema = z.object({
  kind: z.enum(TEMPLATE_KINDS),
  locale: z.enum(routing.locales),
});

/** Drops the override so the shipped default applies again. */
export async function resetEmailTemplateAction(input: unknown): Promise<ActionResponse> {
  try {
    const actor = await requireStaff();
    assertPermission(actor, "email_templates.manage");

    const parsed = resetSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "admin.emailTemplates.invalid" };

    const ok = await resetTemplate(parsed.data.kind, parsed.data.locale, actor.id);

    await recordAuditEvent({
      actorId: actor.id,
      action: "admin.email_template_reset",
      targetType: "email_template",
      targetId: `${parsed.data.kind}:${parsed.data.locale}`,
      result: ok ? "success" : "failure",
      metadata: { kind: parsed.data.kind, locale: parsed.data.locale },
    });

    if (!ok) return { ok: false, message: "admin.emailTemplates.failed" };

    revalidatePath("/admin/email-templates");
    return { ok: true, message: "admin.emailTemplates.reset" };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: "admin.common.notPermitted" };
    logger.error("email_template_reset_failed", { error: String(error) });
    return { ok: false, message: "admin.emailTemplates.failed" };
  }
}
