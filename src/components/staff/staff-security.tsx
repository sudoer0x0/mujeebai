import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { SessionControls } from "@/components/staff/session-controls";
import { ChangePasswordForm } from "@/components/staff/change-password-form";
import { DeviceList } from "@/components/app/device-list";
import { getSessionInfoAction } from "@/admin/session-actions";
import { listDeviceSessions } from "@/auth/device-sessions";
import type { Profile } from "@/auth/session";

/**
 * The security panel, shared by both staff portals.
 *
 * It is one component rather than two pages because the *contents* are
 * identical by definition: this is an operator looking at their own
 * account, and a moderator's session is no less worth protecting than a
 * super admin's. Duplicating it would have meant the moderator copy
 * quietly falling behind the one that gets maintained.
 */
export async function StaffSecurity({ profile, locale }: { profile: Profile; locale: string }) {
  const t = await getTranslations({ locale, namespace: "admin.security" });
  const [info, devices] = await Promise.all([getSessionInfoAction(), listDeviceSessions(profile.id)]);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t("account")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Row label={t("signedInAs")} value={profile.email ?? profile.id} />
          <Row
            label={t("twoFactor")}
            value={
              info.mfaEnrolled ? (
                <Badge variant="success">{t("twoFactorOn")}</Badge>
              ) : (
                <Badge variant="warning">{t("twoFactorOff")}</Badge>
              )
            }
          />
          <Row
            label={t("assurance")}
            // `aal1`/`aal2` is Supabase's vocabulary, not a person's.
            value={
              info.assuranceLevel === "aal2"
                ? t("assuranceTwoFactor")
                : info.assuranceLevel === "aal1"
                  ? t("assurancePassword")
                  : "—"
            }
          />
          <Row
            label={t("lastSignIn")}
            value={info.lastSignInAt ? new Date(info.lastSignInAt).toLocaleString(locale) : "—"}
          />
          <Row
            label={t("sessionSince")}
            value={info.currentSessionSince ? new Date(info.currentSessionSince).toLocaleString(locale) : "—"}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("password")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("recovery")}</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Stated plainly rather than left to be discovered at the worst
              possible moment. There are no printable recovery codes: this
              deployment recovers a lost authenticator through a Super
              Admin, which keeps the reset attributable and audited
              instead of resting on a code in somebody's notes app. */}
          <Alert tone="info">{t("recoveryBody")}</Alert>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("sessions")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <DeviceList sessions={devices} locale={locale} />
          <div className="border-t border-line pt-3">
            <SessionControls locale={locale} />
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
      <span className="text-muted">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}
