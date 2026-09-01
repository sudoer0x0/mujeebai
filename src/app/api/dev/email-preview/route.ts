import { NextResponse, type NextRequest } from "next/server";
import { buildAuthEmail } from "@/notifications/templates/auth";
import { isTemplateKind } from "@/notifications/templates/shared";

export const runtime = "nodejs";

/**
 * Renders a transactional email so it can be read before it is sent.
 *
 * Development only — it returns nothing sensitive, but a public endpoint
 * that renders arbitrary templates is a needless surface, and the 404 in
 * production means it cannot be probed for the template list either.
 */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }

  const kind = request.nextUrl.searchParams.get("kind") ?? "invite";
  const locale = request.nextUrl.searchParams.get("locale") ?? "en";
  if (!isTemplateKind(kind)) return NextResponse.json({ error: "unknown kind" }, { status: 400 });

  const message = await buildAuthEmail(kind, {
    to: "ada@example.com",
    locale,
    displayName: request.nextUrl.searchParams.get("name") ?? "Ada Lovelace",
    actionUrl: "https://mujeebai.yungswag.xyz/en/update-password?token=preview",
  });

  return NextResponse.json({ subject: message.subject, text: message.text, html: message.html });
}
