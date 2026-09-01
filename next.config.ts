import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Next advertises itself in an `X-Powered-By` header by default. It
  // tells an attacker which framework (and therefore which CVE list) to
  // aim at, and tells a legitimate visitor nothing at all.
  poweredByHeader: false,
  // Separate build outputs for dev and production.
  //
  // `next dev` and `next build` write incompatible artifacts, and sharing
  // one directory means whichever ran last wins. The symptom is a runtime
  // failure that looks like a broken dependency —
  // "Cannot find module './vendor-chunks/@supabase.js'" — rather than
  // anything to do with the code, which sends you looking in the wrong
  // place entirely.
  //
  // Next sets NODE_ENV itself (`dev` -> development, `build` -> production),
  // so this splits them without a flag to remember. Deployment output stays
  // at `.next`; only the dev server moves.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  // Keep the document parsers out of the server bundle.
  //
  // `pdf-parse` wraps pdf.js, which resolves `pdf.worker.mjs` by a path
  // relative to itself at runtime. Bundling it rewrites that path into
  // `.next/server/chunks/`, where the worker was never emitted, so every
  // PDF upload failed with "Setting up fake worker failed: Cannot find
  // module …/pdf.worker.mjs" — in production builds only, which is why it
  // survived development. Listing it here leaves it as a plain
  // `node_modules` require, and the relative path resolves again.
  serverExternalPackages: ["pdf-parse", "mammoth", "xlsx"],
  eslint: {
    // Linting is run separately in CI; don't let it block production builds.
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
  async headers() {
    return [
      {
        // Security headers applied to every response — see SECURITY.md.
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // HSTS. Browsers ignore this over plain HTTP, so it is safe to
          // send unconditionally in development; over HTTPS it stops a
          // first-visit downgrade from ever reaching the network again.
          //
          // Two years, subdomains included. `preload` is deliberately
          // omitted: submitting to the preload list is close to
          // irreversible and would break any subdomain not yet served
          // over HTTPS, which is a decision for whoever owns the domain
          // rather than something a config file should assume.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
        ],
      },
      // NOTE: the page Content-Security-Policy is deliberately NOT set
      // here. It needs a per-request nonce so Next's own inline RSC
      // payload scripts are allowed to run, which a static header cannot
      // express — see src/lib/csp.ts and src/middleware.ts.
      {
        // API routes return JSON, never HTML — lock this down to prevent
        // any response from ever being interpreted as an executable page
        // (e.g. if a client is tricked into navigating to an API URL
        // directly, or an error page is rendered unexpectedly).
        source: "/api/:path*",
        headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'" }],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
