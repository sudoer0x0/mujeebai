"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Alert } from "@/components/ui/alert";
import { signOutEverywhereAction } from "@/admin/session-actions";
import { signOutAction } from "@/app/[locale]/(auth)/actions";
import { useStaffBase } from "@/components/staff/use-staff-base";

/**
 * Sign out of this browser, or of everywhere.
 *
 * "Everywhere" asks for confirmation because it ends the current session
 * too — the operator will have to sign in again, with their authenticator,
 * and should not discover that by accident mid-task.
 */
export function SessionControls({ locale }: { locale: string }) {
  const t = useTranslations("admin.security");
  const router = useRouter();
  const base = useStaffBase();
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState<"one" | "all" | null>(null);

  async function signOutHere() {
    setBusy("one");
    await signOutAction();
    router.replace(`/${locale}${base}/staff/login`);
  }

  async function signOutAll() {
    setBusy("all");
    const result = await signOutEverywhereAction();
    if (result.ok) {
      router.replace(`/${locale}${base}/staff/login`);
      router.refresh();
    } else {
      setBusy(null);
      setConfirming(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {confirming ? <Alert tone="warning">{t("signOutAllWarning")}</Alert> : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={busy !== null} onClick={signOutHere}>
          {busy === "one" ? <Spinner /> : null}
          {t("signOutHere")}
        </Button>

        {confirming ? (
          <>
            <Button variant="danger" disabled={busy !== null} onClick={signOutAll}>
              {busy === "all" ? <Spinner /> : null}
              {t("signOutAllConfirm")}
            </Button>
            <Button variant="ghost" disabled={busy !== null} onClick={() => setConfirming(false)}>
              {t("cancel")}
            </Button>
          </>
        ) : (
          <Button variant="secondary" disabled={busy !== null} onClick={() => setConfirming(true)}>
            {t("signOutAll")}
          </Button>
        )}
      </div>
    </div>
  );
}
