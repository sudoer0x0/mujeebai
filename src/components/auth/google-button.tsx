"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { signInWithGoogleAction } from "@/app/[locale]/(auth)/actions";

/**
 * Google's mark, inlined.
 *
 * Not an <img> from Google's CDN: the CSP allows images only from this
 * origin and data URIs, and adding a remote host to the policy for one
 * 20-line logo is a bad trade. Inline SVG also renders correctly in both
 * themes without a second asset.
 */
function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" className="size-[18px]" aria-hidden focusable="false">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

/**
 * Sign in (or sign up) with Google.
 *
 * One button for both: an OAuth provider does not distinguish them, and
 * offering "sign up with Google" beside "sign in with Google" is two
 * controls that do exactly the same thing.
 *
 * The `next` parameter is forwarded so that arriving via a protected link
 * still lands where the person was going. It is re-normalized server-side
 * before it is used, so a crafted `?next=//evil.com` cannot turn the
 * post-auth redirect into an off-site hop.
 */
export function GoogleButton({ label }: { label?: string }) {
  const t = useTranslations("auth");
  const locale = useLocale();
  const params = useSearchParams();
  const [pending, setPending] = React.useState(false);

  return (
    <form action={signInWithGoogleAction} onSubmit={() => setPending(true)} className="w-full">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="next" value={params.get("next") ?? ""} />
      <Button type="submit" variant="outline" disabled={pending} className="h-11 w-full gap-2.5 text-[14px]">
        {pending ? <Spinner /> : <GoogleMark />}
        {label ?? t("google.continue")}
      </Button>
    </form>
  );
}
