"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { signOutAction } from "@/app/[locale]/(auth)/actions";
import { STAFF_IDLE_TIMEOUT_MS, STAFF_HEARTBEAT_MS } from "@/auth/staff-idle";

/** Warn this long before the cut-off, so it is never a silent surprise. */
const WARN_BEFORE_MS = 60 * 1000;

/**
 * Signs an idle operator out of the console.
 *
 * The server enforces the timeout regardless (see src/auth/staff-idle.ts);
 * this exists so that an unattended tab visibly ends rather than sitting
 * on a stale console until someone clicks and gets bounced, and so an
 * operator who is *reading* is not counted as idle.
 *
 * Activity is sampled, not handled per event: a mousemove listener that
 * did work on every event would fire hundreds of times a second. It
 * records a timestamp, and a single interval decides what that means.
 */
export function StaffIdleGuard({ locale }: { locale: string }) {
  const t = useTranslations("admin.security");
  const lastActive = React.useRef(Date.now());
  const lastBeat = React.useRef(Date.now());
  const [secondsLeft, setSecondsLeft] = React.useState<number | null>(null);

  React.useEffect(() => {
    const markActive = () => {
      lastActive.current = Date.now();
      setSecondsLeft(null);
    };

    // `passive` so scroll and touch handling is never blocked by this.
    const events: Array<keyof WindowEventMap> = [
      "mousemove",
      "mousedown",
      "keydown",
      "scroll",
      "touchstart",
      "focus",
    ];
    for (const event of events) {
      window.addEventListener(event, markActive, { passive: true });
    }

    let signingOut = false;

    async function endSession() {
      if (signingOut) return;
      signingOut = true;
      try {
        await signOutAction();
      } finally {
        // A hard navigation: the session cookie is gone server-side and
        // every cached console payload is now stale.
        window.location.href = `/${locale}`;
      }
    }

    const timer = window.setInterval(() => {
      const idleFor = Date.now() - lastActive.current;

      if (idleFor >= STAFF_IDLE_TIMEOUT_MS) {
        void endSession();
        return;
      }

      if (idleFor >= STAFF_IDLE_TIMEOUT_MS - WARN_BEFORE_MS) {
        setSecondsLeft(Math.max(0, Math.ceil((STAFF_IDLE_TIMEOUT_MS - idleFor) / 1000)));
        return;
      }

      // Only report presence when there has actually been some, and no
      // more often than the heartbeat interval.
      if (Date.now() - lastBeat.current >= STAFF_HEARTBEAT_MS && idleFor < STAFF_HEARTBEAT_MS) {
        lastBeat.current = Date.now();
        // Failure is not worth surfacing: the server-side rule is what
        // actually governs, and a missed beat only risks an early
        // sign-out, never a late one.
        void fetch("/api/staff/heartbeat", { method: "POST", cache: "no-store" }).catch(() => undefined);
      }
    }, 5000);

    return () => {
      window.clearInterval(timer);
      for (const event of events) window.removeEventListener(event, markActive);
    };
  }, [locale]);

  if (secondsLeft === null) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-0 z-50 flex justify-center p-3"
    >
      <p className="rounded-md border border-warning/40 bg-surface px-3.5 py-2 text-[13px] text-foreground shadow-sm">
        {t("idleWarning", { seconds: secondsLeft })}
      </p>
    </div>
  );
}
