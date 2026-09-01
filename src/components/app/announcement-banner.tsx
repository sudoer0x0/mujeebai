"use client";

import * as React from "react";
import { Megaphone, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";

/**
 * Platform-wide announcement.
 *
 * ## Why the previous one did nothing
 *
 * `announcement` existed as a `system_settings` row, was validated by the
 * settings action and was editable in the console — and was never read by
 * a single component. Saving it wrote a value nothing displayed.
 *
 * ## Dismissal
 *
 * Keyed by a hash of the message text, so editing the announcement makes
 * it reappear for everyone who dismissed the previous one. Keying it by a
 * constant would mean the second announcement is silently swallowed for
 * every user who dismissed the first — the failure mode that makes
 * banners untrustworthy.
 *
 * Storage is per-browser and best-effort: a dismissal that cannot be saved
 * simply means the banner returns on the next visit, which is the safe
 * direction to fail for something an operator wants seen.
 */
export function AnnouncementBanner({ message }: { message: string }) {
  const t = useTranslations("common");
  // Starts visible so the banner is in the server-rendered HTML.
  //
  // Starting from "dismissed" instead would mean the server emits nothing
  // and the banner only pops in after hydration — invisible to anyone
  // whose JS is slow or blocked, which for an operational notice is the
  // wrong way round. The cost is a brief flash for the minority who
  // already dismissed this exact message; the effect below hides it on
  // the first commit.
  const [dismissed, setDismissed] = React.useState(false);
  const [leaving, setLeaving] = React.useState(false);

  const key = React.useMemo(() => `mujeeb:announcement:${hash(message)}`, [message]);

  // Read after mount, never during render: reading storage while
  // rendering makes the server and client disagree and React throws away
  // the hydrated tree.
  React.useEffect(() => {
    try {
      if (window.localStorage.getItem(key) === "1") setDismissed(true);
    } catch {
      // Storage unavailable (private mode, blocked cookies): show it.
    }
  }, [key]);

  if (dismissed) return null;

  return (
    <div
      data-state={leaving ? "leaving" : "entered"}
      className="announcement"
      // `status`, not `alert`: an announcement is informational, and
      // `alert` interrupts a screen reader mid-sentence.
      role="status"
    >
      <div className="flex items-start gap-2.5 border-b border-line bg-accent-soft px-4 py-2.5 text-[13px] text-foreground sm:px-6">
      <Megaphone className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
      {/* Rendered through the same sanitized Markdown pipeline as chat, so
          an announcement can carry emphasis and links without raw HTML
          ever reaching a reader. */}
      <div className="min-w-0 flex-1 leading-relaxed [&_p]:m-0">
        <MarkdownRenderer content={message} />
      </div>
      <button
        type="button"
        onClick={() => {
          // Play the exit before unmounting. Persisting immediately means
          // a reload mid-animation still counts as dismissed.
          try {
            window.localStorage.setItem(key, "1");
          } catch {
            // Non-fatal: it reappears next visit.
          }
          setLeaving(true);
          window.setTimeout(() => setDismissed(true), PREFERS_REDUCED_MOTION() ? 0 : 220);
        }}
        aria-label={t("dismiss")}
        className="-me-1 rounded p-1 text-muted transition-colors hover:bg-surface-sunken hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <X className="size-3.5" aria-hidden />
      </button>
      </div>
    </div>
  );
}

/**
 * Whether the viewer has asked for reduced motion.
 *
 * Checked at dismiss time rather than cached, because the setting can
 * change while the page is open. The CSS honours the same preference; this
 * only shortens the unmount delay so the banner does not linger for a
 * fifth of a second doing nothing visible.
 */
function PREFERS_REDUCED_MOTION(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Small, stable, non-cryptographic hash — this only has to change when the text does. */
function hash(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i++) h = ((h << 5) + h + value.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
