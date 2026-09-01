-- Paystack subscription token column for cancellation.

alter table subscriptions
  add column if not exists provider_subscription_token text;
