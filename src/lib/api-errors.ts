import "server-only";
import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";

// Generic database error response generator.
export function dbErrorResponse(event: string, error: { message: string } | null | undefined, status = 500) {
  logger.error(event, { error: error?.message ?? "unknown" });
  return NextResponse.json({ error: "errors.serverError.title" }, { status });
}
