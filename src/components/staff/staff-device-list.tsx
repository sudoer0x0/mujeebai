import { getTranslations } from "next-intl/server";
import { Monitor, Smartphone, Tablet, MapPin, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { DeviceSession } from "@/auth/device-sessions";

/**
 * A user's devices, as staff see them.
 *
 * Read-only on purpose. Signing someone else's device out is a heavier
 * action than it looks — it is indistinguishable, from their side, from
 * being locked out — and the account-level controls that already exist
 * (suspend, reset) are the honest way to do it with an audit trail. This
 * exists to answer "was that really them?", which is a question support
 * gets asked and could not previously answer.
 */
export async function StaffDeviceList({
  sessions,
  locale,
}: {
  sessions: DeviceSession[];
  locale: string;
}) {
  const t = await getTranslations({ locale, namespace: "admin.users.detail" });
  const td = await getTranslations({ locale, namespace: "settings.devices" });

  if (sessions.length === 0) {
    return <p className="px-5 py-4 text-[13px] text-muted">{t("noDevices")}</p>;
  }

  return (
    <ul className="divide-y divide-line">
      {sessions.map((session) => {
        const Icon = /iPhone|Android/.test(session.label)
          ? Smartphone
          : /iPad/.test(session.label)
            ? Tablet
            : Monitor;

        return (
          <li key={session.id} className="flex items-start gap-2.5 px-5 py-3">
            <Icon className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-1.5 text-[13px] text-foreground">
                {session.label}
                {session.aal === "aal2" ? (
                  <Badge variant="success">
                    <ShieldCheck className="size-3" aria-hidden />
                    {td("twoFactor")}
                  </Badge>
                ) : null}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-muted">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3 shrink-0" aria-hidden />
                  {session.location ?? td("unknownLocation")}
                </span>
                {session.ip ? <span className="text-faint">· {session.ip}</span> : null}
                <span className="text-faint">
                  ·{" "}
                  {td("lastActive", {
                    when: new Date(session.lastActiveAt ?? session.createdAt).toLocaleString(locale),
                  })}
                </span>
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
