// Provider-agnostic notification (email) contract.
//
// The rest of the application never constructs a Resend — or any other
// provider's — API call directly (master spec #81). It builds an
// `EmailMessage` and hands it to the adapter returned by
// `createEmailAdapter()`. Swapping Resend for SES/Postmark/etc. means
// adding one adapter file and one line in the factory.

export interface EmailMessage {
  to: string;
  subject: string;
  /** Rendered HTML body. */
  html: string;
  /** Plain-text fallback. Always send one — it materially improves deliverability. */
  text: string;
  /** Optional Reply-To, e.g. a support address. */
  replyTo?: string;
  /**
   * Groups related sends so a provider can report on them. Never put
   * user-identifying data here.
   */
  tag?: string;
}

export interface EmailSendResult {
  /** False when the adapter is a no-op (provider not configured). */
  delivered: boolean;
  /** Provider-side message id when the provider returns one. */
  id?: string;
}

export interface EmailAdapter {
  slug: string;
  /** True when the adapter has real credentials and can actually deliver. */
  configured: boolean;
  send(message: EmailMessage): Promise<EmailSendResult>;
}

export class EmailDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}
