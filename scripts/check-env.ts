/**
 * Pre-flight environment check.
 *
 * Reports which providers are configured and what stops working without
 * each one, and never prints a value. Run with `npm run check-env`.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

interface Group {
  label: string;
  vars: string[];
  required?: boolean;
  /** What is unavailable when this group is not configured. */
  impact: string;
}

const GROUPS: Group[] = [
  {
    label: "Supabase (database, auth, storage)",
    vars: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"],
    required: true,
    impact: "Nothing beyond the static marketing pages will work.",
  },
  {
    label: "Supabase service role",
    vars: ["SUPABASE_SERVICE_ROLE_KEY"],
    required: true,
    impact: "Registration, quotas, admin actions, webhooks and the bootstrap script are all unavailable.",
  },
  {
    label: "Site URL",
    vars: ["NEXT_PUBLIC_SITE_URL"],
    required: true,
    impact: "Auth links in emails will point at the wrong host.",
  },
  {
    label: "Resend (transactional email)",
    vars: ["RESEND_API_KEY", "RESEND_FROM_EMAIL"],
    required: true,
    impact:
      "Registration falls back to Supabase's built-in SMTP, which only delivers to project-team addresses — new users will not be able to sign up.",
  },
  {
    label: "OpenRouter (chat + vision)",
    vars: ["OPENROUTER_API_KEY"],
    impact: "Chat cannot reach any model.",
  },
  {
    label: "Cloudflare Workers AI (image generation)",
    vars: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"],
    impact: "Image generation returns a 'not configured' error.",
  },
  {
    label: "Paystack (billing)",
    vars: ["PAYSTACK_SECRET_KEY"],
    impact: "Checkout is disabled; the app stays usable on the free plan.",
  },
  {
    label: "Super Admin bootstrap",
    vars: ["SUPER_ADMIN_SETUP_TOKEN"],
    impact: "scripts/super-admin.ts refuses to run.",
  },
];

console.log("\nMujeeb AI — environment check\n");

let missingRequired = false;

for (const group of GROUPS) {
  const missing = group.vars.filter((name) => !process.env[name]);
  const ok = missing.length === 0;

  if (!ok && group.required) missingRequired = true;

  const mark = ok ? "✓" : group.required ? "✖" : "·";
  console.log(`${mark} ${group.label}`);

  if (!ok) {
    console.log(`    missing: ${missing.join(", ")}`);
    console.log(`    impact:  ${group.impact}`);
  }
}

console.log("");

if (missingRequired) {
  console.log("Required configuration is missing — see .env.example.\n");
  process.exit(1);
}

console.log("All required configuration is present.\n");
