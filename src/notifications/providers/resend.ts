import "server-only";
import { Resend } from "resend";
import { serverEnv, providerStatus } from "@/lib/env.server";
import { logger } from "@/lib/logger";
import { EmailDeliveryError, type EmailAdapter, type EmailMessage } from "@/notifications/types";

// Resend transactional email adapter.
export function createResendAdapter(): EmailAdapter {
  const configured = providerStatus.resend;
  const client = configured ? new Resend(serverEnv.RESEND_API_KEY) : null;

  return {
    slug: "resend",
    configured,

    async send(message: EmailMessage) {
      if (!client) throw new EmailDeliveryError("Resend is not configured on this deployment.");

      const { data, error } = await client.emails.send({
        from: serverEnv.RESEND_FROM_EMAIL,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
        ...(message.tag ? { tags: [{ name: "category", value: message.tag }] } : {}),
      });

      if (error) {
        // Never log the recipient address or the body — only the failure
        // category, so a mail bug stays debuggable without the log itself
        // becoming a record of who signed up and when.
        logger.error("resend_send_failed", { tag: message.tag, reason: error.name });
        throw new EmailDeliveryError(error.message);
      }

      return { delivered: true, id: data?.id };
    },
  };
}
