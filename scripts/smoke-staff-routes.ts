/**
 * Walks every staff console URL with a real, MFA-stepped-up session.
 *
 * ## Why this exists
 *
 * The consoles sit behind a secret path prefix, a role check and an MFA
 * gate. Requesting the URLs unauthenticated only ever proves they
 * redirect; it cannot tell you whether the page an operator actually
 * reaches renders. That gap let a real bug ship: after entering an
 * authenticator code the browser was sent to the *internal* `/admin`
 * rather than the prefixed one, so sign-in succeeded and landed on a 404.
 *
 * So this signs in for real, enrols and verifies a TOTP factor to reach
 * `aal2`, and asks for every page the way a browser would.
 *
 * Run it against a local build:
 *
 *   npm run build && npm run start &
 *   npm run smoke:staff
 *
 * ## Safety
 *
 * It creates a temporary super admin and deletes it at the end, so it
 * refuses to run against anything but a local origin. Pointing it at
 * production would mint a real administrator.
 */
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const REF = URL_.replace("https://", "").split(".")[0];
const BASE = process.env.APP_BASE ?? "http://localhost:3300";

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|$|\/)/.test(BASE)) {
  console.error(
    `Refusing to run against ${BASE}. This script creates a temporary super admin; ` +
      "it is for a local build only.",
  );
  process.exit(1);
}
const ADMIN_SLUG = process.env.ADMIN_PORTAL_SLUG!;
const STAFF_SLUG = process.env.STAFF_PORTAL_SLUG!;

/** RFC 6238 TOTP, 6 digits, 30s step, SHA-1 — what Supabase expects. */
function totp(base32Secret: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of base32Secret.replace(/=+$/, "").toUpperCase()) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac("sha1", bytes).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const value = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(value % 1_000_000).padStart(6, "0");
}

const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
let fails = 0;
function ok(c: boolean, label: string, extra = "") {
  console.log(`  ${c ? "PASS" : "*** FAIL"}  ${label}${extra ? " :: " + extra : ""}`);
  if (!c) fails++;
}

async function main() {
  const stamp = Date.now();
  const email = `zz-flow-${stamp}@example.com`;
  const password = `Fl0w!${stamp}xyzABC`;

  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const userId = created.user.id;
  await admin.from("profiles").update({ role: "super_admin", status: "active", must_change_password: false }).eq("id", userId);

  try {
  const client = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password });
  if (signInErr) throw signInErr;

  // Enrol + verify TOTP so the session reaches aal2, exactly as a real
  // operator's would after entering a code.
  const { data: enroll, error: enrollErr } = await client.auth.mfa.enroll({ factorType: "totp" });
  if (enrollErr) throw enrollErr;
  const code = totp(enroll.totp.secret);
  const { error: verifyErr } = await client.auth.mfa.challengeAndVerify({ factorId: enroll.id, code });
  if (verifyErr) throw verifyErr;
  await admin.from("profiles").update({ mfa_enrolled_at: new Date().toISOString() }).eq("id", userId);

  const { data: sess } = await client.auth.getSession();
  const aal = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  ok(aal.data?.currentLevel === "aal2", "session is stepped up to aal2", String(aal.data?.currentLevel));

  // Supabase's SSR cookie: base64-encoded session JSON, chunk-free here.
  const cookieValue = "base64-" + Buffer.from(JSON.stringify(sess.session)).toString("base64");
  const cookie = `sb-${REF}-auth-token=${cookieValue}`;

  async function visit(path: string, attempt = 0): Promise<{ status: number; location: string }> {
    try {
      await new Promise((r) => setTimeout(r, 120));
      const res = await fetch(`${BASE}${path}`, {
        headers: { cookie, connection: "close" },
        redirect: "manual",
      });
      return { status: res.status, location: res.headers.get("location") ?? "" };
    } catch (e) {
      // Rapid sequential requests occasionally hit a reset keep-alive
      // socket; that is the harness, not the app.
      if (attempt < 2) return visit(path, attempt + 1);
      throw e;
    }
  }

  console.log("\n=== each entrance announces which console it guards ===");
  {
    // The label comes from a header the middleware derives from the
    // *secret*, not the path — `/staff/login` is served under both, so
    // reading the path made the super admin door call itself the
    // moderator one. Asserted over HTTP because the plumbing between
    // middleware and Server Component is the part that broke.
    const label = async (path: string, headers: Record<string, string> = {}) => {
      await new Promise((r) => setTimeout(r, 120));
      const html = await (await fetch(`${BASE}${path}`, { headers: { connection: "close", ...headers } })).text();
      // Read the *rendered* label, not the page text. next-intl ships the
      // whole message catalogue to the client, so every entrance name
      // appears somewhere in the HTML of every page — searching the
      // document made this assert on the translation bundle rather than
      // on what the operator actually sees.
      const match = html.match(/uppercase tracking-wide text-faint">([^<]*)/);
      const rendered = match?.[1] ?? "";
      if (rendered.includes("Super admin")) return "admin";
      if (rendered.includes("Moderator")) return "moderator";
      if (rendered.includes("Staff")) return "shared";
      return `unknown(${rendered})`;
    };

    ok((await label(`/en/${ADMIN_SLUG}/staff/login`)) === "admin", "admin entrance says super admin");
    ok((await label(`/en/${STAFF_SLUG}/staff/login`)) === "moderator", "moderator entrance says moderator");
    // The browser must never be able to state its own area.
    ok(
      (await label(`/en/${STAFF_SLUG}/staff/login`, { "x-portal-area": "admin" })) === "moderator",
      "a forged x-portal-area header is ignored",
    );
  }

  console.log("\n=== every super-admin console page, authenticated + aal2 ===");
  const adminPages = ["", "/users", "/moderation", "/usage", "/plans", "/subscriptions", "/models",
    "/providers", "/system-prompt", "/feature-flags", "/settings", "/audit-logs", "/moderators",
    "/security", "/status", "/announcements", "/email-templates"];
  for (const page of adminPages) {
    const p = `/en/${ADMIN_SLUG}/admin${page}`;
    const r = await visit(p);
    ok(r.status === 200, `/admin${page || ""}`.padEnd(22) + ` -> ${r.status}`, r.location);
  }

  console.log("\n=== moderator console ===");
  for (const page of ["", "/users", "/moderation", "/activity", "/security"]) {
    const r = await visit(`/en/${STAFF_SLUG}/moderator${page}`);
    ok(r.status === 200, `/moderator${page || ""}`.padEnd(22) + ` -> ${r.status}`, r.location);
  }

  console.log("\n=== the MFA landing path that was 404ing ===");
  const landing = await visit(`/en/${ADMIN_SLUG}/admin`);
  ok(landing.status === 200, "post-MFA destination resolves", String(landing.status));
  const bare = await visit("/en/admin");
  ok(bare.status === 404, "the unprefixed path still 404s for an authenticated admin", String(bare.status));

  console.log("\n=== the step-up screen ===");
  {
    // A fresh password sign-in leaves the session at aal1 — the exact
    // state this screen renders in. It has twice reported something
    // untrue about a perfectly good authenticator, so what it *says* is
    // asserted, not just that it renders.
    const fresh = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    await fresh.auth.signInWithPassword({ email, password });
    const { data: freshSess } = await fresh.auth.getSession();
    const freshCookie = `sb-${REF}-auth-token=base64-${Buffer.from(JSON.stringify(freshSess.session)).toString("base64")}`;

    await new Promise((r) => setTimeout(r, 120));
    const html = await (
      await fetch(`${BASE}/en/${ADMIN_SLUG}/staff/login?step=mfa&next=%2Fadmin`, {
        headers: { cookie: freshCookie, connection: "close" },
      })
    ).text();

    // Rendered alerts only — next-intl ships every error string to the
    // client, so searching the document matches the catalogue.
    const alerts = [...html.matchAll(/role="alert"[^>]*>([^<]*)/g)].map((m) => m[1].trim()).filter(Boolean);
    ok(!alerts.some((a) => /No authenticator/.test(a)), "no alert claims the account has no authenticator");
    ok(/Six-digit/.test(html), "the code form renders");
    ok(html.includes(enroll.id), "the factor id is resolved server-side, not looked up in the browser");
    ok(!/scripts\/super-admin\.ts/.test(html), "no script path is shown to operators");
  }

  console.log("\n=== a moderator sees the moderator console and not the admin one ===");
  {
    const modEmail = `zz-mod-${stamp}@example.com`;
    const modPassword = `Md1!${stamp}pqrsTU`;
    const { data: mod, error: modError } = await admin.auth.admin.createUser({
      email: modEmail,
      password: modPassword,
      email_confirm: true,
    });
    if (modError || !mod?.user) throw new Error(`moderator setup failed: ${modError?.message}`);
    const modId = mod.user.id;
    try {
      await admin
        .from("profiles")
        .update({ role: "moderator", status: "active", must_change_password: false })
        .eq("id", modId);

      const modClient = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
      await modClient.auth.signInWithPassword({ email: modEmail, password: modPassword });
      const { data: modEnroll, error: modEnrollError } = await modClient.auth.mfa.enroll({ factorType: "totp" });
      if (modEnrollError || !modEnroll) throw new Error("moderator MFA enrol failed");
      await modClient.auth.mfa.challengeAndVerify({
        factorId: modEnroll.id,
        code: totp(modEnroll.totp.secret),
      });
      await admin.from("profiles").update({ mfa_enrolled_at: new Date().toISOString() }).eq("id", modId);

      const { data: modSess } = await modClient.auth.getSession();
      const modCookie = `sb-${REF}-auth-token=base64-${Buffer.from(JSON.stringify(modSess.session)).toString("base64")}`;

      const ask = async (path: string) => {
        await new Promise((r) => setTimeout(r, 120));
        const res = await fetch(`${BASE}${path}`, {
          headers: { cookie: modCookie, connection: "close" },
          redirect: "manual",
        });
        return res.status;
      };

      ok((await ask(`/en/${STAFF_SLUG}/moderator`)) === 200, "moderator reaches the moderator console");
      // The whole reason the consoles have separate secrets.
      ok((await ask(`/en/${STAFF_SLUG}/admin`)) === 404, "moderator secret does not reach /admin");
      ok([307, 404].includes(await ask(`/en/${ADMIN_SLUG}/admin`)), "moderator is refused the admin console");
    } finally {
      await admin.auth.admin.deleteUser(modId).catch(() => undefined);
    }
  }

  console.log("\n=== a user detail page ===");
  const det = await visit(`/en/${ADMIN_SLUG}/admin/users/${userId}`);
  ok(det.status === 200, "admin user detail", String(det.status));

  console.log(fails === 0 ? "\n  EVERY STAFF URL WORKS" : `\n  ${fails} FAILURES`);
  if (fails) process.exitCode = 1;
  } finally {
    // Guaranteed, including on a thrown request error. An earlier run
    // aborted mid-walk and left a real super_admin on the project — a
    // cleanup that only runs on the happy path is not a cleanup.
    await admin.auth.admin.deleteUser(userId).catch(() => undefined);
  }
}
main().catch((e) => {
  console.error("FATAL", e?.message ?? e);
  process.exitCode = 1;
});
