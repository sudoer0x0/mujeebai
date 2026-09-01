"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";
import { Input, Field } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Alert } from "@/components/ui/alert";
import { toast } from "@/components/ui/toast";
import { inviteUserAction } from "@/admin/invite-actions";

/**
 * Invites an ordinary customer account.
 *
 * No role selector, and that is the point rather than an omission: this
 * form is offered to moderators, and a role field on a form a moderator
 * can reach would be a privilege-escalation control regardless of what
 * the server does with it. The action has no `role` parameter to send.
 */
export function InviteUserForm({ locale }: { locale: string }) {
  const t = useTranslations("admin.invite");
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [vip, setVip] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [sentTo, setSentTo] = React.useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setSentTo(null);
    try {
      const result = await inviteUserAction({
        email,
        displayName: displayName.trim() || undefined,
        locale,
        vip,
      });

      if (result.ok) {
        setSentTo(result.email ?? email);
        setEmail("");
        setDisplayName("");
        setVip(false);
        router.refresh();
      } else {
        toast.error(t((result.message?.split(".").pop() ?? "failed") as never));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {sentTo ? <Alert tone="success">{t("sentTo", { email: sentTo })}</Alert> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="invite-email" label={t("emailLabel")} required>
          <Input
            type="email"
            name="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="off"
            required
            placeholder="name@example.com"
          />
        </Field>

        <Field id="invite-name" label={t("nameLabel")}>
          <Input
            name="displayName"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            autoComplete="off"
            maxLength={80}
          />
        </Field>
      </div>

      {/* A special invitation changes the email, not the account.
          Its wording is deliberately close to the standard one: a louder,
          more "exclusive" version was written and it went to junk, so the
          differentiation is kept small until the sending domain has SPF,
          DKIM and DMARC in place. Said on the control itself so nobody
          sends one expecting it to grant something. */}
      <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-line bg-surface-sunken p-3">
        <input
          type="checkbox"
          checked={vip}
          onChange={(event) => setVip(event.target.checked)}
          className="mt-0.5 size-4 accent-[var(--accent)]"
        />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
            <Sparkles className="size-3.5 text-accent" aria-hidden />
            {t("vipLabel")}
          </span>
          <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">{t("vipHint")}</span>
        </span>
      </label>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending || !email.trim()}>
          {pending ? <Spinner /> : null}
          {vip ? t("submitVip") : t("submit")}
        </Button>
        <p className="text-[12px] text-muted">{t("hint")}</p>
      </div>
    </form>
  );
}
