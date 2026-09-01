"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Monitor, Smartphone, Tablet, ShieldCheck, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { toast } from "@/components/ui/toast";
import { revokeMyDeviceAction, signOutOtherDevicesAction } from "@/app/[locale]/(app)/settings/session-actions";
import type { DeviceSession } from "@/auth/device-sessions";

function DeviceIcon({ label }: { label: string }) {
  if (/iPhone|Android/.test(label)) return <Smartphone className="size-4 text-muted" aria-hidden />;
  if (/iPad/.test(label)) return <Tablet className="size-4 text-muted" aria-hidden />;
  return <Monitor className="size-4 text-muted" aria-hidden />;
}

/**
 * Where this account is signed in.
 *
 * The current device is pinned first and cannot be signed out from here —
 * that is what the ordinary sign-out is for, and offering it in a list of
 * "other places you're signed in" invites an accidental self-logout while
 * someone is trying to remove a device they don't recognise.
 */
export function DeviceList({
  sessions,
  locale,
}: {
  sessions: DeviceSession[];
  locale: string;
}) {
  const t = useTranslations("settings.devices");
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [confirmAll, setConfirmAll] = React.useState(false);

  const others = sessions.filter((session) => !session.current);

  async function revoke(sessionId: string) {
    setBusy(sessionId);
    try {
      const result = await revokeMyDeviceAction({ sessionId });
      if (result.ok) {
        toast.success(t("revoked"));
        router.refresh();
      } else {
        toast.error(t((result.message?.split(".").pop() ?? "failed") as never));
      }
    } finally {
      setBusy(null);
    }
  }

  async function revokeOthers() {
    setBusy("all");
    try {
      const result = await signOutOtherDevicesAction();
      if (result.ok) {
        toast.success(t("othersRevoked"));
        setConfirmAll(false);
        router.refresh();
      } else {
        toast.error(t("failed"));
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y divide-line">
        {sessions.map((session) => (
          <li key={session.id} className="flex items-start justify-between gap-3 py-3 first:pt-0">
            <div className="flex min-w-0 gap-2.5">
              <span className="mt-0.5 shrink-0">
                <DeviceIcon label={session.label} />
              </span>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-1.5 text-[13px] text-foreground">
                  {session.label}
                  {session.current ? <Badge variant="success">{t("thisDevice")}</Badge> : null}
                  {session.aal === "aal2" ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted">
                      <ShieldCheck className="size-3" aria-hidden />
                      {t("twoFactor")}
                    </span>
                  ) : null}
                </p>
                {/* Place first, then address, then when — the order a
                    person checks them in when deciding "is this me?". */}
                <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-muted">
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3 shrink-0" aria-hidden />
                    {session.location ?? t("unknownLocation")}
                  </span>
                  {session.ip ? <span className="text-faint">· {session.ip}</span> : null}
                  <span className="text-faint">
                    ·{" "}
                    {t("lastActive", {
                      when: new Date(session.lastActiveAt ?? session.createdAt).toLocaleString(locale),
                    })}
                  </span>
                </p>
              </div>
            </div>

            {!session.current ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy !== null}
                onClick={() => revoke(session.id)}
              >
                {busy === session.id ? <Spinner /> : null}
                {t("signOutDevice")}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>

      {others.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          {confirmAll ? <Alert tone="warning">{t("signOutOthersWarning", { count: others.length })}</Alert> : null}
          <div className="flex flex-wrap gap-2">
            {confirmAll ? (
              <>
                <Button variant="danger" size="sm" disabled={busy !== null} onClick={revokeOthers}>
                  {busy === "all" ? <Spinner /> : null}
                  {t("signOutOthersConfirm")}
                </Button>
                <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => setConfirmAll(false)}>
                  {t("cancel")}
                </Button>
              </>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => setConfirmAll(true)}>
                {t("signOutOthers")}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <p className="text-[12px] text-muted">{t("onlyThisDevice")}</p>
      )}
    </div>
  );
}
