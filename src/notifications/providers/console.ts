import "server-only";
import { logger } from "@/lib/logger";
import type { EmailAdapter, EmailMessage } from "@/notifications/types";

/**
 * Fallback adapter used when no email provider is configured.
 *
 * It deliberately reports `delivered: false` rather than pretending to
 * have sent something — callers use that to tell the user "we could not
 * email you" instead of showing a check-your-inbox screen for a mail that
 * will never arrive. In development it prints the action link to the
 * server console so local sign-up flows remain completable without any
 * provider credentials.
 */
export function createConsoleAdapter(): EmailAdapter {
  return {
    slug: "console",
    configured: false,

    async send(message: EmailMessage) {
      logger.warn("email_provider_not_configured", { tag: message.tag, subject: message.subject });
      if (process.env.NODE_ENV !== "production") {
        // Dev-only convenience. Guarded so a misconfigured production
        // deployment can never print a verification link to its logs.
        console.info(`\n[email:dev] to=${message.to}\n[email:dev] subject=${message.subject}\n${message.text}\n`);
      }
      return { delivered: false };
    },
  };
}
