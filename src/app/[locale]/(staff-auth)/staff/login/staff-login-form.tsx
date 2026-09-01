"use client";

import * as React from "react";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { useStaffBase } from "@/components/staff/use-staff-base";
import { useSearchParams } from "next/navigation";
import { useRouter } from "@/i18n/navigation";
import { staffSignInAction, type StaffAuthResult } from "./actions";
import { Input, Field } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Alert } from "@/components/ui/alert";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

const initialState: StaffAuthResult = { ok: false };

/**
 * Staff sign-in.
 *
 * Deliberately narrower than the customer form: password only, no magic
 * link, no "create account", no password-reset self-service. An
 * administrator who has lost access is recovered through
 * `scripts/super-admin.ts` by someone with server access — that is the
 * whole point of the bootstrap script, and offering an email-based reset
 * here would put the platform's most privileged accounts behind whatever
 * an inbox is worth.
 */
export function StaffLoginForm({ stepUpFactorId }: { stepUpFactorId?: string }) {
  const t = useTranslations("staffAuth");
  const tAuth = useTranslations("auth");
  const router = useRouter();
  const params = useSearchParams();
  const [state, action, pending] = useActionState(staffSignInAction, initialState);

  // Sent here by a portal guard when the session was not staff.
  const denied = params.get("error") === "not_staff";
  // The idle cut-off sends `?error=idle`. Said plainly, because being
  // returned to a sign-in page with no explanation reads as a bug.
  const timedOut = params.get("error") === "idle";

  // A portal guard sends `?step=mfa` when the session is authenticated and
  // enrolled but has not been stepped up. Showing the password form there
  // was the bug: an operator who had just signed in was asked to sign in
  // again, with no explanation, and read it as the console demanding MFA
  // setup over and over. Go straight to the code.
  const stepUp = params.get("step") === "mfa";
  // The step-up path is the one case the browser still has to build for
  // itself: arriving here with `?step=mfa` means there is no sign-in
  // response to read a destination from. `next` is the internal path the
  // guard recorded, and the prefix comes from this page's own URL — which
  // is correct here, because the guard sent the operator to the entrance
  // that matches where they were going.
  const base = useStaffBase();
  const stepUpDestination = `${base}${params.get("next") ?? "/admin"}`;

  // When the account has an authenticator, the password step is only
  // half of sign-in: the session is still aal1 and every staff page would
  // send it straight back. So the form switches to collecting a code
  // instead of navigating.
  React.useEffect(() => {
    if (state.ok && state.portal && !state.requiresMfa) {
      // `state.portal` already carries the right secret prefix, chosen
      // server-side from this account's role. Prefixing it again with the
      // slug from *this page's* URL is what sent a super admin signing in
      // at the moderator entrance to `/{moderatorSlug}/admin`, which 404s.
      router.replace(state.portal);
      router.refresh();
    }
  }, [state.ok, state.portal, state.requiresMfa, router, base]);

  if (stepUp && !state.ok) {
    return <StaffMfaChallenge destination={stepUpDestination} serverFactorId={stepUpFactorId} />;
  }

  if (state.ok && state.requiresMfa && state.portal) {
    // `state.portal` is the *internal* path ("/admin"). It has to carry
    // the secret prefix like every other staff destination, or the code
    // is accepted and the operator is dropped on a 404. The step-up
    // branch above got this right and this one did not — which is why
    // the prefixing is done in one place now rather than at each call.
    return <StaffMfaChallenge destination={state.portal} serverFactorId={state.mfaFactorId} />;
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[15px] font-semibold tracking-tight text-foreground">{t("title")}</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">{t("subtitle")}</p>
      </div>

      {denied && !state.error ? <Alert tone="warning">{t("errors.notStaff")}</Alert> : null}
      {timedOut && !state.error ? <Alert tone="info">{t("errors.idleTimeout")}</Alert> : null}

      <form action={action} className="flex flex-col gap-3.5" noValidate>
        {state.error ? <Alert tone="danger">{t(`errors.${state.error}` as never)}</Alert> : null}

        <Field id="staff-email" label={tAuth("email.label")} required>
          <Input
            name="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            placeholder={tAuth("email.placeholder")}
          />
        </Field>

        <Field id="staff-password" label={tAuth("password.label")} required>
          <PasswordInput
            name="password"
            autoComplete="current-password"
            showLabel={tAuth("showPassword")}
            hideLabel={tAuth("hidePassword")}
          />
        </Field>

        <Button type="submit" size="lg" disabled={pending} className="mt-1 w-full">
          {pending ? <Spinner /> : null}
          {t("submit")}
        </Button>
      </form>

    </div>
  );
}

/**
 * Second step of staff sign-in: the authenticator code.
 *
 * Verified in the browser against Supabase, which is what actually raises
 * the session to aal2 — the level `checkStaffGate` requires. A server
 * action could not do it without the session's own client.
 */
function StaffMfaChallenge({
  destination,
  serverFactorId,
}: {
  destination: string;
  /** Resolved server-side during sign-in; absent on the `?step=mfa` path. */
  serverFactorId?: string;
}) {
  const t = useTranslations("staffAuth");
  const router = useRouter();
  const supabase = React.useMemo(() => createBrowserSupabaseClient(), []);
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [checking, setChecking] = React.useState(true);

  /**
   * Skip the challenge when the session is already stepped up.
   *
   * This is the bug that presented as "that code isn't right" for a code
   * that was perfectly correct. A step-up that *succeeded* but whose
   * destination then failed left the session at aal2; coming back to this
   * screen and entering a fresh code asked Supabase to challenge a factor
   * already verified for this session, which it refuses — and every
   * refusal was being reported as a bad code.
   *
   * There is nothing to prove here if the session already proves it.
   */
  React.useEffect(() => {
    let cancelled = false;
    supabase.auth.mfa
      .getAuthenticatorAssuranceLevel()
      .then(({ data }) => {
        if (cancelled) return;
        if (data?.currentLevel === "aal2") {
          router.replace(destination);
          router.refresh();
          return;
        }
        setChecking(false);
      })
      .catch(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, router, destination]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Re-read the session from cookies first.
      //
      // This client is memoised at mount, which is *before* the password
      // step sets the new session cookie. Its in-memory session can
      // therefore be stale or absent, and a challenge issued on a stale
      // session fails in a way that looks exactly like a wrong code.
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session) {
        setError(t("errors.sessionLost"));
        return;
      }

      // The factor id is supplied by the server, which read it from the
      // account while authenticating. Looking it up here as well meant a
      // browser-side call could fail — for a stale client, a network blip,
      // anything — and be reported as "no authenticator is set up" on an
      // account that plainly had one. `factorId` is not a secret: it
      // identifies a factor whose codes only the holder can produce.
      let factorId = serverFactorId;

      if (!factorId) {
        const { data: factors } = await supabase.auth.mfa.listFactors();
        factorId = (factors?.totp ?? []).find((factor) => factor.status === "verified")?.id;
      }

      if (!factorId) {
        setError(t("errors.mfaUnavailable"));
        return;
      }

      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code: code.replace(/\s/g, ""),
      });

      if (verifyError) {
        // Only two things are reported with confidence: an HTTP status
        // says what it says, and anything else is treated as a wrong code
        // because that is overwhelmingly what it is.
        //
        // What is *not* done here any more is guessing from the provider's
        // error text and falling back to "no authenticator is set up".
        // That fallback was reached by unrecognised errors and told
        // operators their perfectly good authenticator did not exist —
        // the same misdirection as reporting everything as a bad code,
        // reintroduced by a supposed fix for it. The real message is
        // logged; the screen says only what it knows.
        const status = (verifyError as { status?: number }).status;
        console.error("staff_mfa_verify_failed", { status, message: verifyError.message });

        if (status === 429) {
          setError(t("errors.mfaRateLimited"));
        } else if (status && status >= 500) {
          setError(t("errors.mfaServerError"));
        } else {
          setError(t("errors.mfaBadCode"));
        }
        return;
      }

      router.replace(destination);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // Nothing is asked for until we know whether it needs asking.
  if (checking) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[15px] font-semibold tracking-tight text-foreground">{t("mfaTitle")}</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">{t("mfaSubtitle")}</p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-3.5">
        {error ? <Alert tone="danger">{error}</Alert> : null}

        <Field id="staff-totp" label={t("mfaCodeLabel")} required>
          <Input
            name="code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            autoFocus
            required
            className="text-center font-mono text-[15px] tracking-[0.3em]"
          />
        </Field>

        <Button type="submit" size="lg" disabled={busy || code.length < 6} className="mt-1 w-full">
          {busy ? <Spinner /> : null}
          {t("mfaSubmit")}
        </Button>
      </form>
    </div>
  );
}
