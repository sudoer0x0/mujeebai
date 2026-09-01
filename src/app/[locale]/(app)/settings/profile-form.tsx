"use client";

import * as React from "react";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { updateProfileAction, type ProfileActionState } from "./actions";
import { Input, Field } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Alert } from "@/components/ui/alert";
import { toast } from "@/components/ui/toast";
import { FONT_CHOICES, type FontChoice } from "@/lib/fonts";
import { ACCENT_CHOICES, ACCENT_SWATCHES, type AccentChoice } from "@/lib/accents";
import { cn } from "@/lib/utils";

const initialState: ProfileActionState = { ok: false };

export function ProfileForm({
  initialDisplayName,
  email,
  initialFont = "system",
  initialAccent = "default",
}: {
  initialDisplayName: string;
  email: string;
  initialTheme?: string;
  initialFont?: FontChoice;
  initialAccent?: AccentChoice;
}) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const tf = useTranslations("settings.fonts");
  const ta = useTranslations("settings.accents");
  const [state, action, pending] = useActionState(updateProfileAction, initialState);
  const [displayName, setDisplayName] = React.useState(initialDisplayName);
  const [font, setFont] = React.useState<FontChoice>(initialFont);
  const [accent, setAccent] = React.useState<AccentChoice>(initialAccent);

  const dirty =
    displayName.trim() !== initialDisplayName.trim() || font !== initialFont || accent !== initialAccent;

  React.useEffect(() => {
    if (state.ok) toast.success(t("saved"));
  }, [state.ok, t]);

  return (
    <form action={action} className="flex flex-col gap-4">
      {state.error ? <Alert tone="danger">{t("saveFailed")}</Alert> : null}

      <Field id="displayName" label={t("displayName")} description={t("displayNameHint")} required>
        <Input
          name="displayName"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          maxLength={80}
          autoComplete="name"
        />
      </Field>

      {/* Email is shown for orientation but is not editable here: changing
          it is an authentication event that requires confirming the new
          address, not a profile field. */}
      <Field id="email" label={t("email")} description={t("emailHint")}>
        <Input value={email} readOnly disabled autoComplete="email" />
      </Field>

      {/* Reading font. The list is fixed — picking sends an identifier,
          never a font name — and every option is a stack already present
          on the device, so nothing is downloaded and no third party is
          contacted. See src/lib/fonts.ts. */}
      <Field id="font" label={t("font")} description={t("fontHint")}>
        <div className="flex flex-wrap gap-2">
          {FONT_CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              onClick={() => setFont(choice)}
              aria-pressed={font === choice}
              data-font={choice}
              className={cn(
                "rounded-md border px-3 py-2 text-[13px] transition-colors",
                // The sample renders in the font it offers, so the choice
                // is made by looking rather than by guessing at a label.
                "[font-family:var(--font-sans)]",
                font === choice
                  ? "border-accent bg-accent-soft text-foreground"
                  : "border-line bg-surface text-muted hover:border-line-strong hover:text-foreground",
              )}
            >
              {tf(choice)}
            </button>
          ))}
        </div>
      </Field>
      {/* Accent colour. The swatch sets `data-accent` on the document as
          soon as it is clicked, so the whole app — buttons, links, focus
          rings, the chat send button — recolours under the cursor rather
          than only after saving. The value sent is an identifier from a
          fixed list, never a colour: see src/lib/accents.ts. */}
      <Field id="accent" label={t("accent")} description={t("accentHint")}>
        <div className="flex flex-wrap gap-2">
          {ACCENT_CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              onClick={() => {
                setAccent(choice);
                if (choice === "default") document.documentElement.removeAttribute("data-accent");
                else document.documentElement.setAttribute("data-accent", choice);
              }}
              aria-pressed={accent === choice}
              aria-label={ta(choice)}
              title={ta(choice)}
              className={cn(
                "flex size-9 items-center justify-center rounded-full border-2 transition-transform",
                "hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                accent === choice ? "border-foreground" : "border-transparent",
              )}
            >
              <span
                className="size-6 rounded-full"
                style={{ background: ACCENT_SWATCHES[choice] }}
                aria-hidden
              />
            </button>
          ))}
        </div>
      </Field>

      <input type="hidden" name="font" value={font} />
      <input type="hidden" name="accent" value={accent} />

      <div>
        <Button type="submit" disabled={pending || !dirty}>
          {pending ? <Spinner /> : null}
          {tc("save")}
        </Button>
      </div>
    </form>
  );
}
