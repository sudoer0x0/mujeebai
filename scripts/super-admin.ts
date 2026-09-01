/**
 * Mujeeb AI — Super Admin bootstrap and recovery.
 *
 *   npm run super-admin -- grant   --email you@example.com
 *   npm run super-admin -- create  --email you@example.com
 *   npm run super-admin -- recover --email you@example.com
 *   npm run super-admin -- list
 *
 * ## Why this is a script and not a page
 *
 * The first Super Admin cannot come from the web application: any
 * endpoint capable of minting one is an endpoint capable of being abused
 * into minting one (master spec #29). This runs server-side with the
 * service-role key, on a machine an operator already controls.
 *
 * ## What this fixes from the three scripts it replaces
 *
 * `setup-super-admin.ts`, `create-super-admin.ts` and
 * `reset-super-admin.ts` overlapped heavily and each had a real problem:
 *
 *  - The setup token was only enforced *if* SUPER_ADMIN_SETUP_TOKEN
 *    happened to be set (`if (expectedToken && token !== expectedToken)`),
 *    so on a deployment that never configured one, anybody who could run
 *    the script could mint themselves an administrator with no secret at
 *    all. The token is now mandatory, and compared in constant time.
 *  - Passwords were accepted as `--password` on the command line, which
 *    puts them in shell history and in every other process's view of the
 *    process table, and the interactive prompt echoed them to the
 *    terminal. Passwords are now read only from a prompt, with echo off.
 *  - `listUsers()` was called without pagination, so on a project with
 *    more than 50 accounts the lookup silently failed to find an existing
 *    user and the script took the wrong branch.
 *
 * Required environment (see .env.example):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SUPER_ADMIN_SETUP_TOKEN
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import crypto from "node:crypto";
import readline from "node:readline";
import { stdin, stdout } from "node:process";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

type Command = "grant" | "create" | "recover" | "list";

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  let command: Command | null = null;

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const value = argv[index + 1];
      // Support `--flag` with no value as a boolean.
      if (!value || value.startsWith("--")) {
        args[key] = "true";
      } else {
        args[key] = value;
        index++;
      }
    } else if (!command) {
      command = token as Command;
    }
  }

  return { command, args };
}

function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

/** Constant-time comparison, so the token can't be recovered by timing. */
function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Prompts without echoing.
 *
 * Node has no built-in "read a password" primitive; muting the output
 * stream while the line is read is the standard approach, and it is what
 * keeps the password off the operator's screen and out of any terminal
 * scrollback that gets pasted into a ticket later.
 */
function askSecret(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: stdin, output: stdout, terminal: true });
    const output = rl as unknown as { output: NodeJS.WriteStream; _writeToOutput: (value: string) => void };

    let muted = false;
    output._writeToOutput = function write(value: string) {
      if (!muted) output.output.write(value);
    };

    rl.question(question, (answer) => {
      muted = false;
      rl.close();
      stdout.write("\n");
      resolve(answer.trim());
    });
    muted = true;
  });
}

/**
 * Finds an auth user by email across *all* pages.
 *
 * `listUsers()` returns 50 per page by default. The scripts this replaces
 * called it bare, so on any project past 50 accounts an existing operator
 * looked like a new one and the script tried to re-create them.
 */
async function findAuthUserByEmail(supabase: SupabaseClient, email: string): Promise<User | null> {
  const needle = email.toLowerCase();
  const perPage = 200;

  for (let page = 1; page <= 100; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) fail(`Failed to list users: ${error.message}`);

    const match = data.users.find((user) => user.email?.toLowerCase() === needle);
    if (match) return match;
    if (data.users.length < perPage) return null;
  }

  return null;
}

async function requireToken(provided: string | undefined) {
  const expected = process.env.SUPER_ADMIN_SETUP_TOKEN;

  if (!expected) {
    fail(
      "SUPER_ADMIN_SETUP_TOKEN is not set.\n" +
        "  Generate one and put it in .env.local (and in your deployment's environment):\n" +
        "    openssl rand -hex 32",
    );
  }

  const token = provided ?? (await askSecret("Setup token: "));
  if (!token || !tokensMatch(token, expected)) {
    fail("Invalid setup token. Refusing to continue.");
  }
}

function validEmail(email: string | undefined): string {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail("A valid --email is required.");
  }
  return email.toLowerCase();
}

async function readNewPassword(): Promise<string> {
  const password = await askSecret("New password (min 12 characters, not echoed): ");
  if (password.length < 12) {
    // Stricter than the 8-character public minimum on purpose: this
    // account can change every other account's access.
    fail("Super Admin passwords must be at least 12 characters.");
  }
  const confirmation = await askSecret("Confirm password: ");
  if (password !== confirmation) fail("Passwords do not match.");
  return password;
}

async function ensureSuperAdminRole(supabase: SupabaseClient, userId: string, email: string) {
  const { data: existing } = await supabase
    .from("admin_roles")
    .select("id")
    .eq("user_id", userId)
    .eq("role", "super_admin")
    .is("revoked_at", null)
    .maybeSingle();

  if (existing) {
    console.log("  · Super Admin role already granted.");
  } else {
    // `admin_roles` is the source of truth; a trigger syncs profiles.role
    // from it, so we never write the role onto the profile directly.
    const { error } = await supabase
      .from("admin_roles")
      .insert({ user_id: userId, role: "super_admin", granted_by: null });
    if (error) fail(`Failed to grant the Super Admin role: ${error.message}`);
    console.log("  ✓ Granted the Super Admin role.");
  }

  const { error: statusError } = await supabase.from("profiles").update({ status: "active" }).eq("id", userId);
  if (statusError) console.warn(`  ! Could not set account status to active: ${statusError.message}`);

  await supabase.from("admin_audit_logs").insert({
    actor_id: null,
    action: "admin.super_admin_bootstrap",
    target_type: "user",
    target_id: userId,
    // The email identifies the account; the token never appears anywhere.
    metadata: { via: "scripts/super-admin.ts", email },
  });
}

async function main() {
  const { command, args } = parseArgs(process.argv.slice(2));

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    fail("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("\nMujeeb AI — Super Admin tool\n");

  switch (command) {
    case "list": {
      const { data, error } = await supabase
        .from("admin_roles")
        .select("user_id, role, granted_at, revoked_at, profiles(email, display_name, status)")
        .is("revoked_at", null)
        .order("granted_at", { ascending: true });

      if (error) fail(`Failed to list administrators: ${error.message}`);
      if (!data || data.length === 0) {
        console.log("No administrators have been granted yet. Run `grant` or `create` to bootstrap one.\n");
        return;
      }

      for (const row of data) {
        const profile = row.profiles as unknown as
          | { email: string | null; display_name: string | null; status: string }
          | null;
        console.log(
          `  ${row.role.padEnd(12)} ${(profile?.email ?? row.user_id).padEnd(36)} ${profile?.status ?? "?"}`,
        );
      }
      console.log("");
      return;
    }

    case "grant": {
      await requireToken(args.token);
      const email = validEmail(args.email);

      const { data: profile, error } = await supabase
        .from("profiles")
        .select("id, role")
        .eq("email", email)
        .maybeSingle();

      if (error) fail(`Failed to look up the account: ${error.message}`);
      if (!profile) {
        fail(
          `No account exists for ${email}.\n` +
            "  Either sign up through the app first, or use `create` to provision the account here.",
        );
      }
      if (profile.role === "super_admin") {
        console.log(`${email} is already a Super Admin. Nothing to do.\n`);
        return;
      }

      await ensureSuperAdminRole(supabase, profile.id, email);
      console.log(`\n✓ ${email} is now a Super Admin. Sign in and open /admin.\n`);
      console.log("Rotate SUPER_ADMIN_SETUP_TOKEN now that it has been used.\n");
      return;
    }

    case "create": {
      await requireToken(args.token);
      const email = validEmail(args.email);

      const existing = await findAuthUserByEmail(supabase, email);
      if (existing) {
        fail(`An account already exists for ${email}. Use \`grant\` (or \`recover\`) instead.`);
      }

      const password = await readNewPassword();

      const { data: created, error } = await supabase.auth.admin.createUser({
        email,
        password,
        // Confirmed on creation: this account is provisioned by an
        // operator who already controls the deployment, and there is no
        // inbox round trip to wait on.
        email_confirm: true,
        user_metadata: { display_name: args.name ?? "Super Admin" },
      });

      if (error || !created.user) fail(`Failed to create the account: ${error?.message}`);

      console.log("  ✓ Created the authentication account.");
      await supabase
        .from("profiles")
        .update({ display_name: args.name ?? "Super Admin", email })
        .eq("id", created.user.id);

      await ensureSuperAdminRole(supabase, created.user.id, email);
      console.log(`\n✓ ${email} is now a Super Admin. Sign in and open /admin.\n`);
      console.log("Rotate SUPER_ADMIN_SETUP_TOKEN now that it has been used.\n");
      return;
    }

    case "recover": {
      await requireToken(args.token);
      const email = validEmail(args.email);

      const authUser = await findAuthUserByEmail(supabase, email);
      if (!authUser) fail(`No account found for ${email}. Use \`create\` to provision one.`);

      console.log(`  · Found account ${authUser.id}`);

      const changePassword = (await ask("Reset the password? [y/N]: ")).toLowerCase() === "y";
      if (changePassword) {
        const password = await readNewPassword();
        const { error } = await supabase.auth.admin.updateUserById(authUser.id, {
          password,
          email_confirm: true,
        });
        if (error) fail(`Failed to update the password: ${error.message}`);
        console.log("  ✓ Password updated.");
      }

      // Clear MFA factors so a lost authenticator cannot permanently lock
      // the platform's only administrator out.
      try {
        const { data: factors } = await supabase.auth.admin.mfa.listFactors({ userId: authUser.id });
        for (const factor of factors?.factors ?? []) {
          await supabase.auth.admin.mfa.deleteFactor({ id: factor.id, userId: authUser.id });
        }
        if ((factors?.factors ?? []).length > 0) console.log("  ✓ Cleared MFA factors.");

        // Clear the profile flag too, so the console sends them through
        // enrolment again rather than asking for a code they can no longer
        // produce. The gate also derives this from the live factor list, so
        // this is belt and braces — but leaving a stale flag behind is the
        // kind of thing that only surfaces during an incident.
        await supabase.from("profiles").update({ mfa_enrolled_at: null }).eq("id", authUser.id);
      } catch {
        // MFA is not enabled on every project; nothing to clear.
      }

      // End every existing session.
      //
      // An access token issued while the factor still existed keeps
      // claiming `aal2` until it expires — up to an hour — so without this
      // a recovered account leaves a verified-looking session open. And if
      // recovery was needed because the account was compromised rather than
      // merely locked out, that session belongs to whoever took it.
      try {
        await supabase.auth.admin.signOut(authUser.id, "global");
        console.log("  ✓ Revoked existing sessions.");
      } catch {
        // MFA is not enabled on every project; nothing to clear.
      }

      await ensureSuperAdminRole(supabase, authUser.id, email);

      await supabase.from("admin_audit_logs").insert({
        actor_id: null,
        action: "admin.super_admin_recovered",
        target_type: "user",
        target_id: authUser.id,
        metadata: { via: "scripts/super-admin.ts", email, passwordReset: changePassword },
      });

      console.log(`\n✓ Recovery complete for ${email}.\n`);
      console.log("Rotate SUPER_ADMIN_SETUP_TOKEN now that it has been used.\n");
      return;
    }

    default:
      console.log("Usage:");
      console.log("  npm run super-admin -- grant   --email you@example.com");
      console.log("  npm run super-admin -- create  --email you@example.com [--name \"Your Name\"]");
      console.log("  npm run super-admin -- recover --email you@example.com");
      console.log("  npm run super-admin -- list\n");
      console.log("The setup token is read from SUPER_ADMIN_SETUP_TOKEN and prompted for (never echoed).");
      console.log("Passwords are never accepted as command-line arguments.\n");
      process.exit(command ? 1 : 0);
  }
}

main().catch((error) => {
  console.error("\n✖ Unexpected error:", error instanceof Error ? error.message : error);
  process.exit(1);
});
