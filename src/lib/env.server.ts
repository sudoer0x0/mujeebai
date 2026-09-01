import "server-only";
import { z } from "zod";

/**
 * Server-only configuration.
 *
 * The `server-only` import above is the actual guard: any Client
 * Component that imports this module — directly or transitively — fails
 * the build instead of shipping a secret to the browser.
 *
 * Every provider is optional at the type level. The app boots without any
 * of them and each dependent feature degrades with a clear message rather
 * than crashing at startup, which is what makes a partially-configured
 * preview deployment usable.
 */
const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  OPENROUTER_SITE_URL: z.string().optional(),
  OPENROUTER_APP_NAME: z.string().default("Mujeeb AI"),

  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
  CLOUDFLARE_API_TOKEN: z.string().optional(),
  CLOUDFLARE_IMAGE_MODEL: z.string().default("@cf/black-forest-labs/flux-1-schnell"),

  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().default("Mujeeb AI <noreply@yungswag.xyz>"),

  PAYSTACK_SECRET_KEY: z.string().optional(),
  PAYSTACK_PUBLIC_KEY: z.string().optional(),
  /**
   * Paystack signs webhooks with the account's **secret key**, not a
   * separate webhook secret — its dashboard never issues one. Keeping the
   * variable allows an explicit override, but it falls back to the secret
   * key so a deployment that leaves it unset still verifies signatures
   * correctly instead of rejecting every event.
   */
  PAYSTACK_WEBHOOK_SECRET: z.string().optional(),

  SUPER_ADMIN_SETUP_TOKEN: z.string().optional(),

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export const serverEnv = serverSchema.parse(process.env);

/** True when a given external provider has real credentials configured. */
export const providerStatus = {
  supabaseServiceRole: Boolean(serverEnv.SUPABASE_SERVICE_ROLE_KEY),
  openrouter: Boolean(serverEnv.OPENROUTER_API_KEY),
  cloudflareImages: Boolean(serverEnv.CLOUDFLARE_ACCOUNT_ID && serverEnv.CLOUDFLARE_API_TOKEN),
  resend: Boolean(serverEnv.RESEND_API_KEY),
  paystack: Boolean(serverEnv.PAYSTACK_SECRET_KEY),
} as const;

/** The key Paystack actually signs webhooks with on this deployment. */
export function paystackSigningSecret(): string | undefined {
  return serverEnv.PAYSTACK_WEBHOOK_SECRET || serverEnv.PAYSTACK_SECRET_KEY;
}
