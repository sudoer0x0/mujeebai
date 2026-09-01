import "server-only";
import { clientEnv } from "@/lib/env";
import { providerStatus, serverEnv } from "@/lib/env.server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

export type ServiceState = "operational" | "degraded" | "not_configured" | "error";

export interface ServiceStatus {
  slug: string;
  name: string;
  state: ServiceState;
  /** Non-sensitive detail: a status code, a latency, a config hint. */
  detail: string;
}

/**
 * Live health checks for every external dependency.
 *
 * Each probe is the cheapest authenticated call the provider offers, so
 * this page reports whether the *credentials this deployment actually
 * holds* work — not merely whether an environment variable is non-empty.
 * A key that is present but revoked is exactly the failure this is for.
 *
 * Nothing here returns a credential, and every probe is individually
 * timed out so one hanging provider cannot hang the page.
 */
const PROBE_TIMEOUT_MS = 4000;

async function withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function probe(
  slug: string,
  name: string,
  configured: boolean,
  check: (signal: AbortSignal) => Promise<string>,
): Promise<ServiceStatus> {
  if (!configured) {
    return { slug, name, state: "not_configured", detail: "Credentials are not set on this deployment." };
  }
  const started = Date.now();
  try {
    const detail = await withTimeout(check);
    return { slug, name, state: "operational", detail: `${detail} · ${Date.now() - started}ms` };
  } catch (error) {
    // The message is shown to a super admin only, and providers do not
    // echo credentials in error bodies — but keep it to a short reason
    // rather than a full response dump regardless.
    const reason = error instanceof Error ? error.message.slice(0, 160) : "Unknown error";
    logger.warn("platform_status_probe_failed", { slug, reason });
    return { slug, name, state: "error", detail: reason };
  }
}

export async function getPlatformStatus(): Promise<ServiceStatus[]> {
  return Promise.all([
    probe("supabase", "Supabase", Boolean(clientEnv.NEXT_PUBLIC_SUPABASE_URL), async () => {
      const supabase = createServiceRoleClient();
      const { error } = await supabase.from("plans").select("id", { count: "exact", head: true });
      if (error) throw new Error(error.message);
      return "Database reachable";
    }),

    probe("openrouter", "OpenRouter", providerStatus.openrouter, async (signal) => {
      const response = await fetch(`${serverEnv.OPENROUTER_BASE_URL}/key`, {
        headers: { Authorization: `Bearer ${serverEnv.OPENROUTER_API_KEY}` },
        signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return "API key valid";
    }),

    probe("cloudflare", "Cloudflare Workers AI", providerStatus.cloudflareImages, async (signal) => {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${serverEnv.CLOUDFLARE_ACCOUNT_ID}/ai/models/search?per_page=1`,
        { headers: { Authorization: `Bearer ${serverEnv.CLOUDFLARE_API_TOKEN}` }, signal },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return "Account token valid";
    }),

    probe("resend", "Resend", providerStatus.resend, async (signal) => {
      const response = await fetch("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${serverEnv.RESEND_API_KEY}` },
        signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { data?: Array<{ name: string; status: string }> };
      const verified = (body.data ?? []).filter((domain) => domain.status === "verified");
      if (verified.length === 0) throw new Error("No verified sending domain");
      return `${verified.length} verified domain(s)`;
    }),

    probe("paystack", "Paystack", providerStatus.paystack, async (signal) => {
      const response = await fetch("https://api.paystack.co/transaction/totals?perPage=1", {
        headers: { Authorization: `Bearer ${serverEnv.PAYSTACK_SECRET_KEY}` },
        signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return "Secret key valid";
    }),

    probe("storage", "Object storage", providerStatus.supabaseServiceRole, async () => {
      const supabase = createServiceRoleClient();
      const { data, error } = await supabase.storage.listBuckets();
      if (error) throw new Error(error.message);
      const bucket = (data ?? []).find((entry) => entry.name === "mujeeb-files");
      if (!bucket) throw new Error("Bucket 'mujeeb-files' is missing");
      if (bucket.public) throw new Error("Bucket 'mujeeb-files' is public — it must be private");
      return "Bucket present and private";
    }),
  ]);
}
