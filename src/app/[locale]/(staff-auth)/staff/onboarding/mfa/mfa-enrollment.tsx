"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { Input, Field } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Alert } from "@/components/ui/alert";
import { confirmMfaEnrolledAction } from "../actions";

/**
 * TOTP enrolment.
 *
 * The enrol/verify handshake runs in the browser against Supabase on
 * purpose: the QR code and the shared secret are meant for one pair of
 * eyes, and proxying them through the application server would put a
 * credential into server logs and request traces for no benefit. The
 * server's job is to *verify* afterwards that a verified factor exists —
 * `confirmMfaEnrolledAction` asks Supabase directly rather than believing
 * this component.
 */
export function MfaEnrollment({ locale, destination }: { locale: string; destination: string }) {
  const t = useTranslations("staffAuth.onboarding");
  const router = useRouter();
  const supabase = React.useMemo(() => createBrowserSupabaseClient(), []);

  const [qr, setQr] = React.useState<string | null>(null);
  const [secret, setSecret] = React.useState<string | null>(null);
  const [factorId, setFactorId] = React.useState<string | null>(null);
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Enrol once on mount, reusing an unverified factor if the operator
  // reloaded the page — enrolling repeatedly would litter the account with
  // dead factors and eventually hit Supabase's per-user limit.
  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data: existing } = await supabase.auth.mfa.listFactors();
        const unverified = (existing?.all ?? []).find(
          (factor) => factor.factor_type === "totp" && factor.status === "unverified",
        );
        if (unverified) {
          await supabase.auth.mfa.unenroll({ factorId: unverified.id });
        }

        const { data, error: enrollError } = await supabase.auth.mfa.enroll({
          factorType: "totp",
          friendlyName: `mujeeb-staff-${Date.now()}`,
        });
        if (cancelled) return;
        if (enrollError || !data) {
          setError(t("mfaEnrollFailed"));
          return;
        }
        setFactorId(data.id);
        setQr(data.totp.qr_code);
        setSecret(data.totp.secret);
      } catch {
        if (!cancelled) setError(t("mfaEnrollFailed"));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase, t]);

  async function verify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!factorId) return;

    setBusy(true);
    setError(null);
    try {
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code: code.replace(/\s/g, ""),
      });

      if (verifyError) {
        setError(t("mfaBadCode"));
        return;
      }

      const confirmed = await confirmMfaEnrolledAction();
      if (!confirmed.ok) {
        setError(t("mfaFailed"));
        return;
      }

      router.replace(`/${locale}${destination}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {qr ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-line bg-surface-sunken p-4">
          {/* Supabase returns the QR as an SVG data URI. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt={t("mfaQrAlt")} width={180} height={180} className="rounded bg-white p-2" />
          {secret ? (
            <div className="w-full text-center">
              <p className="text-[11px] uppercase tracking-wide text-faint">{t("mfaSecretLabel")}</p>
              <p className="mt-1 select-all break-all font-mono text-[12px] text-foreground">{secret}</p>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      )}

      {/* Said here, at the moment someone would look for them. Supabase's
          MFA API has no notion of recovery or backup codes — TOTP enrol
          returns a QR, a secret and a URI, and nothing else — so their
          absence is not a rendering failure with something to fix. This
          deployment recovers a lost authenticator through a Super Admin
          instead, which keeps the reset attributable and audited rather
          than resting on a code in someone's notes app. */}
      <Alert tone="info">{t("mfaNoRecoveryCodes")}</Alert>

      <form onSubmit={verify} className="flex flex-col gap-3">
        <Field id="totp-code" label={t("mfaCodeLabel")} required>
          <Input
            name="code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            // A TOTP code is six digits; the numeric keypad and one-time-code
            // autofill make this far less painful on a phone.
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            required
            className="text-center font-mono text-[15px] tracking-[0.3em]"
          />
        </Field>

        <Button type="submit" disabled={busy || !factorId || code.length < 6}>
          {busy ? <Spinner /> : null}
          {t("mfaSubmit")}
        </Button>
      </form>
    </div>
  );
}
