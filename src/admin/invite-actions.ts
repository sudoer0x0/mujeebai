"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff, ForbiddenError } from "@/auth/session";
import { assertPermission } from "@/admin/permissions";
import { recordAuditEvent } from "@/admin/audit";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { sendAuthLink } from "@/auth/registration";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import type { ActionResponse } from "@/admin/user-actions";

/**
 * Inviting an ordinary customer account.
 *
 * ## Why this went back to a Supabase auth link
 *
 * I rewrote this to send a token-free link to the sign-up page, on the
 * theory that a long tokenised URL was why invitations were being
 * filtered. It was a reasonable theory and it was wrong: after the
 * change, the *ordinary* invite — which had been arriving reliably —
 * started landing in junk too.
 *
 * The evidence points at the wording, not the mechanism. The message
 * built on the `magicLink` template reaches the inbox; a new template
 * with invitation-flavoured copy does not, whether or not it carries a
 * token. So the mechanism is restored to the one with a delivery record,
 * and the special invitation is now a *small* variation on it rather than
 * a different message.
 *
 * The real fix is domain-level and cannot be made from here: SPF, DKIM
 * and DMARC for the sending domain. Until those are in place, any mail
 * from a young domain will drift toward junk regardless of its contents.
 *
 * ## What the flow does
 *
 * The account row is created first, so the invite is a real account from
 * the moment it is issued: it appears in the user list, an operator can
 * see it was sent, and undo has something concrete to remove. The
 * recipient redeems a one-time link and sets their own password.
 */

const inviteSchema = z.object({
  email: z.string().email().max(200),
  displayName: z.string().trim().min(1).max(80).optional(),
  locale: z.string().min(2).max(5).default("en"),
  // A special invitation. Changes the *email* only — the account gets
  // exactly the same permissions as any other, which is why both staff
  // roles may send one.
  vip: z.boolean().default(false),
});

export async function inviteUserAction(input: unknown): Promise<ActionResponse & { email?: string }> {
  try {
    const actor = await requireStaff();
    assertPermission(actor, "users.invite");

    // Each invite sends mail to an address the operator typed. Without a
    // ceiling, a compromised staff account becomes a way to send mail
    // from this domain to arbitrary recipients, which is how a sending
    // reputation gets destroyed.
    const { allowed } = checkRateLimit(`user-invite:${actor.id}`, 20, 60 * 60_000);
    if (!allowed) return { ok: false, message: "admin.invite.throttled" };

    const parsed = inviteSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "admin.invite.invalid" };

    const email = parsed.data.email.trim().toLowerCase();
    const admin = createServiceRoleClient();

    // An existing address is never silently reused. Re-inviting someone
    // who already has an account would either do nothing or, worse, look
    // to the operator as though it had provisioned something.
    const { data: existing } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
    if (existing) return { ok: false, message: "admin.invite.alreadyExists" };

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      // Unconfirmed on purpose: redeeming the emailed link is what proves
      // the address belongs to whoever is signing in. Confirming it here
      // would mean a mistyped address produced a usable account.
      email_confirm: false,
    });

    if (createError || !created?.user) {
      logger.error("user_invite_create_failed", { error: createError?.message });
      return { ok: false, message: "admin.invite.failed" };
    }

    const userId = created.user.id;

    const { error: profileError } = await admin
      .from("profiles")
      .update({
        display_name: parsed.data.displayName ?? email.split("@")[0],
        locale: parsed.data.locale,
        invited_by: actor.id,
        invited_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (profileError) {
      await admin.auth.admin.deleteUser(userId).catch(() => undefined);
      logger.error("user_invite_profile_failed", { error: profileError.message });
      return { ok: false, message: "admin.invite.failed" };
    }

    // The special invitation keeps its own template so the toggle still
    // does something, but its copy is now modelled on the message that
    // actually gets delivered: same structure, same length, and none of
    // the words ("exclusive", "VIP", "you have been selected") that
    // filters weight heavily. See the note at the top of this file.
    const { delivered } = await sendAuthLink({
      kind: parsed.data.vip ? "vipInvite" : "magicLink",
      email,
      locale: parsed.data.locale,
      next: "/update-password",
    });

    await recordAuditEvent({
      actorId: actor.id,
      action: "admin.user_invited",
      targetType: "user",
      targetId: userId,
      result: delivered ? "success" : "failure",
      metadata: { email, emailDelivered: delivered, invitedBy: actor.id, vip: parsed.data.vip },
    });

    if (!delivered) {
      // Nobody can reach the account, so leaving it would only litter the
      // user list with a row that can never be signed into. Roll back and
      // let the operator retry once mail is working.
      await admin.auth.admin.deleteUser(userId).catch(() => undefined);
      logger.error("user_invite_email_failed_rolled_back", { userId });
      return { ok: false, message: "admin.invite.emailFailed" };
    }

    revalidatePath("/admin/users");
    revalidatePath("/moderator/users");
    return {
      ok: true,
      message: parsed.data.vip ? "admin.invite.sentVip" : "admin.invite.sent",
      email,
    };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: "admin.common.notPermitted" };
    logger.error("user_invite_unexpected", { error: String(error) });
    return { ok: false, message: "admin.invite.failed" };
  }
}
