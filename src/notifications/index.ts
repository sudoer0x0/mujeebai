import "server-only";
import { createResendAdapter } from "@/notifications/providers/resend";
import { createConsoleAdapter } from "@/notifications/providers/console";
import { logger } from "@/lib/logger";
import type { EmailAdapter, EmailMessage, EmailSendResult } from "@/notifications/types";

let cached: EmailAdapter | null = null;

/** Returns the configured email adapter (Resend today, pluggable later). */
export function createEmailAdapter(): EmailAdapter {
  if (cached) return cached;

  const provider = process.env.EMAIL_PROVIDER ?? "resend";
  switch (provider) {
    case "resend": {
      const resend = createResendAdapter();
      cached = resend.configured ? resend : createConsoleAdapter();
      return cached;
    }
    case "console":
      cached = createConsoleAdapter();
      return cached;
    default:
      throw new Error(
        `Unknown EMAIL_PROVIDER '${provider}'. Implement an adapter and register it in src/notifications/index.ts.`,
      );
  }
}

/**
 * Sends an email, never throwing. Callers that must know whether delivery
 * actually happened (sign-up verification, password reset) should check
 * `delivered` and surface an honest error to the user rather than a
 * check-your-inbox screen.
 */
export async function sendEmail(message: EmailMessage): Promise<EmailSendResult> {
  try {
    return await createEmailAdapter().send(message);
  } catch (error) {
    logger.error("email_send_failed", { tag: message.tag, error: String(error) });
    return { delivered: false };
  }
}

export type { EmailMessage, EmailAdapter, EmailSendResult } from "@/notifications/types";
