"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireActiveProfile } from "@/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { routing } from "@/i18n/routing";
import { cookies } from "next/headers";
import { FONT_CHOICES, FONT_COOKIE, FONT_COOKIE_MAX_AGE } from "@/lib/fonts";
import { ACCENT_CHOICES, ACCENT_COOKIE, ACCENT_COOKIE_MAX_AGE } from "@/lib/accents";
import { logger } from "@/lib/logger";

export interface ProfileActionState {
  ok: boolean;
  error?: boolean;
}

const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  locale: z.enum(routing.locales).optional(),
  theme: z.enum(["system", "light", "dark"]).optional(),
  // An enum, so the value that reaches `data-font` can only ever be one
  // of five known identifiers — never a font-family string.
  font: z.enum(FONT_CHOICES).optional(),
  // An enum, so the value that reaches `data-accent` can only ever be one
  // of seven known identifiers — never a colour string.
  accent: z.enum(ACCENT_CHOICES).optional(),
});

/**
 * Updates the caller's own profile.
 *
 * Only the four self-service fields are writable here. `role` and
 * `status` are deliberately absent, and are additionally refused by a
 * database trigger for any non-service-role connection — so even a forged
 * request carrying `role: "super_admin"` cannot escalate.
 */
export async function updateProfileAction(
  _previous: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const profile = await requireActiveProfile();

  const parsed = profileSchema.safeParse({
    displayName: formData.get("displayName") ?? undefined,
    accent: formData.get("accent") ?? undefined,
    locale: formData.get("locale") ?? undefined,
    theme: formData.get("theme") ?? undefined,
    font: formData.get("font") ?? undefined,
  });

  if (!parsed.success) return { ok: false, error: true };

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      ...(parsed.data.displayName !== undefined ? { display_name: parsed.data.displayName } : {}),
      ...(parsed.data.locale ? { locale: parsed.data.locale } : {}),
      ...(parsed.data.theme ? { theme: parsed.data.theme } : {}),
      ...(parsed.data.font ? { font_preference: parsed.data.font } : {}),
      ...(parsed.data.accent ? { accent_preference: parsed.data.accent } : {}),
    })
    .eq("id", profile.id);

  if (error) {
    logger.warn("profile_update_failed", { reason: error.message });
    return { ok: false, error: true };
  }

  // The render path reads the cookie, not the column — see
  // public/theme-init.js for why. Written here so the change takes effect
  // on the very next paint.
  if (parsed.data.accent) {
    const jar = await cookies();
    jar.set(ACCENT_COOKIE, parsed.data.accent, {
      maxAge: ACCENT_COOKIE_MAX_AGE,
      path: "/",
      sameSite: "lax",
      // Read by /theme-init.js before paint, which is the point.
      httpOnly: false,
    });
  }

  if (parsed.data.font) {
    const jar = await cookies();
    jar.set(FONT_COOKIE, parsed.data.font, {
      maxAge: FONT_COOKIE_MAX_AGE,
      path: "/",
      sameSite: "lax",
      // Readable by /theme-init.js in the browser, which is the point.
      httpOnly: false,
    });
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
