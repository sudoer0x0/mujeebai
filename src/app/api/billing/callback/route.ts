import { NextResponse, type NextRequest } from "next/server";
import { verifyTransaction } from "@/billing/paystack";
import { logger } from "@/lib/logger";

// Browser redirect after Paystack checkout.
export async function GET(request: NextRequest) {
  const reference = request.nextUrl.searchParams.get("reference") ?? request.nextUrl.searchParams.get("trxref");
  const redirectTo = new URL("/settings", request.url);

  if (!reference) return NextResponse.redirect(redirectTo);

  try {
    const transaction = await verifyTransaction(reference);
    if (transaction.status === "success") {
      redirectTo.searchParams.set("billing", "success");
    } else {
      redirectTo.searchParams.set("billing", "pending");
    }
  } catch (error) {
    logger.warn("billing_callback_verify_failed", { reference, error: String(error) });
    redirectTo.searchParams.set("billing", "pending");
  }

  return NextResponse.redirect(redirectTo);
}
