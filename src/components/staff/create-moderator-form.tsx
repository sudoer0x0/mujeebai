"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Input, Field } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Alert } from "@/components/ui/alert";
import { toast } from "@/components/ui/toast";
import { createModeratorAction } from "@/admin/moderator-actions";

/**
 * Provisions a moderator by email.
 *
 * There is no password field on purpose. An operator typing a password
 * here would have to transmit it to the invitee somehow — over chat, most
 * likely — and it would never expire. The generated one is emailed
 * directly to the address entered and is useless until replaced.
 */
export function CreateModeratorForm({ locale }: { locale: string }) {
  const t = useTranslations("admin.moderators");
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [sentTo, setSentTo] = React.useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setSentTo(null);
    try {
      const result = await createModeratorAction({
        email,
        displayName: displayName.trim() || undefined,
        locale,
      });

      if (result.ok) {
        setSentTo(result.email ?? email);
        setEmail("");
        setDisplayName("");
        router.refresh();
      } else {
        toast.error(t((result.message?.split(".").pop() ?? "createFailed") as never));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {sentTo ? <Alert tone="success">{t("createdFor", { email: sentTo })}</Alert> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="moderator-email" label={t("emailLabel")} required>
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

        <Field id="moderator-name" label={t("nameLabel")}>
          <Input
            name="displayName"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            autoComplete="off"
            maxLength={80}
          />
        </Field>
      </div>

      <p className="text-[12px] leading-relaxed text-muted">{t("createHint")}</p>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending || !email.trim()}>
          {pending ? <Spinner /> : null}
          {t("createSubmit")}
        </Button>
      </div>
    </form>
  );
}
