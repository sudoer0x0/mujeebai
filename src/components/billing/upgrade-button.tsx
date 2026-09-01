"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";

/**
 * Minimal shape of Paystack's inline API, as loaded from their CDN.
 *
 * Typed by hand rather than pulled from a package: this is the whole
 * surface used, and a dependency for two method signatures is not worth
 * the supply chain.
 */
interface PaystackPopup {
  resumeTransaction: (
    accessCode: string,
    callbacks?: {
      onSuccess?: (transaction: { reference: string }) => void;
      onCancel?: () => void;
      onError?: (error: unknown) => void;
    },
  ) => void;
}

declare global {
  interface Window {
    PaystackPop?: { new (): PaystackPopup };
  }
}

const PAYSTACK_SCRIPT = "https://js.paystack.co/v2/inline.js";

/**
 * Loads Paystack's inline script once, on demand.
 *
 * Deliberately not in the document head: nobody visiting the marketing
 * page should pay for a payment SDK they may never use, and loading it at
 * the moment of intent keeps the rest of the app free of it.
 */
function loadPaystack(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.PaystackPop) return Promise.resolve(true);

  return new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${PAYSTACK_SCRIPT}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(Boolean(window.PaystackPop)), { once: true });
      existing.addEventListener("error", () => resolve(false), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = PAYSTACK_SCRIPT;
    script.async = true;
    script.onload = () => resolve(Boolean(window.PaystackPop));
    // A blocked or failed script is not an error worth showing — the
    // redirect fallback below handles it and the customer still pays.
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

export function UpgradeButton({
  planSlug = "pro",
  label,
  className,
}: {
  planSlug?: string;
  label?: string;
  className?: string;
}) {
  const t = useTranslations("billing");
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);

  async function handleUpgrade() {
    setLoading(true);
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // No currency and no amount: the server decides both, from the
        // visitor's stored preference. The browser only names the plan.
        body: JSON.stringify({ planSlug }),
      });
      const data = await response.json();

      if (!response.ok || !data.authorizationUrl) {
        // Distinguish "this deployment has no payment provider" from a
        // transient failure — telling someone to "try again" when
        // Paystack simply is not configured wastes their time.
        toast.error(data.reason === "not_configured" ? t("notConfigured") : t("checkoutError"));
        setLoading(false);
        return;
      }

      // Preferred path: Paystack's modal, over the page the customer is
      // already on. Card details are entered inside their iframe, so this
      // application never touches them.
      const ready = data.accessCode ? await loadPaystack() : false;

      if (ready && window.PaystackPop) {
        const popup = new window.PaystackPop();
        popup.resumeTransaction(data.accessCode, {
          onSuccess: () => {
            // The webhook is what actually grants the plan; this only
            // brings the page back in line once it has.
            toast.success(t("pending"));
            router.replace("/settings?billing=success");
            router.refresh();
          },
          onCancel: () => setLoading(false),
          onError: () => {
            toast.error(t("checkoutError"));
            setLoading(false);
          },
        });
        return;
      }

      // Fallback: their hosted page. Same transaction, same reference.
      window.location.href = data.authorizationUrl;
    } catch {
      toast.error(t("checkoutError"));
      setLoading(false);
    }
  }

  return (
    <Button onClick={handleUpgrade} disabled={loading} className={className ?? "w-full"}>
      {loading ? <Spinner /> : null}
      {label ?? t("upgrade")}
    </Button>
  );
}
