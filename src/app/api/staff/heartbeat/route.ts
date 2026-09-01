import { NextResponse } from "next/server";
import { requireStaff } from "@/auth/session";
import { STAFF_SEEN_COOKIE, STAFF_IDLE_TIMEOUT_MS } from "@/auth/staff-idle";

export const runtime = "nodejs";

/**
 * Marks the operator as still present.
 *
 * The idle cut-off is enforced in middleware from a cookie timestamp,
 * which only advances when a request is made. Without this, an operator
 * *reading* a long audit log — genuinely working, but not navigating —
 * would be signed out mid-sentence. The console pings this while there is
 * real interaction, and stops the moment there is not.
 *
 * `requireStaff()` is the point: this endpoint can extend a session, so
 * it must be reachable only by someone who already holds a staff one.
 * Anonymous or customer callers get nothing to extend.
 */
export async function POST() {
  try {
    await requireStaff();
  } catch {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(STAFF_SEEN_COOKIE, String(Date.now()), {
    // httpOnly so the page cannot forge its own "still here" — the
    // heartbeat has to go through the authenticated endpoint above.
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.ceil(STAFF_IDLE_TIMEOUT_MS / 1000),
  });
  return response;
}
