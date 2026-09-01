"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { History, RotateCcw, Save, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import {
  saveEmailTemplateAction,
  restoreEmailTemplateAction,
  resetEmailTemplateAction,
} from "@/admin/email-template-actions";
import { TEMPLATE_PLACEHOLDERS } from "@/notifications/templates/shared";

export interface EditorTemplate {
  kind: string;
  locale: string;
  subject: string;
  preview: string;
  heading: string;
  body: string;
  actionLabel: string;
  footnote: string;
  version: number;
  /** Whether this (kind, locale) is overridden at all. */
  configured: boolean;
}

export interface EditorVersion {
  version: number;
  subject: string;
  heading: string;
  body: string;
  changeNote: string | null;
  restoredFrom: number | null;
  createdAt: string;
  authorName: string | null;
}

/**
 * Editing one transactional email, with its history.
 *
 * The defaults are shown as placeholder text rather than pre-filled
 * values. That distinction is the whole design: an empty field means
 * "use the shipped copy", so an operator can override the subject alone
 * and leave everything else tracking the built-in translations — which
 * keeps six other locales correct for free.
 */
export function EmailTemplateEditor({
  kinds,
  locales,
  template,
  versions,
  defaults,
}: {
  kinds: string[];
  locales: string[];
  template: EditorTemplate;
  versions: EditorVersion[];
  /** The shipped copy for this (kind, locale), shown as placeholders. */
  defaults: { subject: string; preview: string; heading: string; body: string; actionLabel: string; footnote: string };
}) {
  const t = useTranslations("admin.emailTemplates");
  const tc = useTranslations("admin.common");
  const router = useRouter();

  const [fields, setFields] = React.useState({
    subject: template.subject,
    preview: template.preview,
    heading: template.heading,
    body: template.body,
    actionLabel: template.actionLabel,
    footnote: template.footnote,
  });
  const [changeNote, setChangeNote] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [showHistory, setShowHistory] = React.useState(false);
  const [confirmReset, setConfirmReset] = React.useState(false);
  const [restoring, setRestoring] = React.useState<number | null>(null);

  // Re-seed when the selected template changes; without this, switching
  // kind would leave the previous template's text in the fields.
  React.useEffect(() => {
    setFields({
      subject: template.subject,
      preview: template.preview,
      heading: template.heading,
      body: template.body,
      actionLabel: template.actionLabel,
      footnote: template.footnote,
    });
    setChangeNote("");
  }, [template]);

  function navigate(next: { kind?: string; locale?: string }) {
    const params = new URLSearchParams({
      kind: next.kind ?? template.kind,
      locale: next.locale ?? template.locale,
    });
    router.push(`?${params.toString()}`);
  }

  async function save() {
    setPending(true);
    try {
      const result = await saveEmailTemplateAction({
        kind: template.kind,
        locale: template.locale,
        ...fields,
        changeNote: changeNote.trim() || undefined,
      });
      if (result.ok) {
        toast.success(t("saved", { version: result.version ?? 0 }));
        setChangeNote("");
        router.refresh();
      } else {
        toast.error(t((result.message?.split(".").pop() ?? "failed") as never));
      }
    } finally {
      setPending(false);
    }
  }

  async function restore(version: number) {
    setRestoring(version);
    try {
      const result = await restoreEmailTemplateAction({
        kind: template.kind,
        locale: template.locale,
        version,
      });
      if (result.ok) {
        toast.success(t("restored", { version }));
        router.refresh();
      } else {
        toast.error(t((result.message?.split(".").pop() ?? "failed") as never));
      }
    } finally {
      setRestoring(null);
    }
  }

  async function reset() {
    setPending(true);
    try {
      const result = await resetEmailTemplateAction({ kind: template.kind, locale: template.locale });
      if (result.ok) {
        toast.success(t("reset"));
        router.refresh();
      } else {
        toast.error(tc("actionFailed"));
      }
      setConfirmReset(false);
    } finally {
      setPending(false);
    }
  }

  const set = (key: keyof typeof fields) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setFields((current) => ({ ...current, [key]: event.target.value }));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="template-kind" label={t("kindLabel")}>
          <Select value={template.kind} onValueChange={(kind) => navigate({ kind })}>
            <SelectTrigger id="template-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {kinds.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {t(`kind.${kind}` as never)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field id="template-locale" label={t("localeLabel")}>
          <Select value={template.locale} onValueChange={(locale) => navigate({ locale })}>
            <SelectTrigger id="template-locale">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {locales.map((locale) => (
                <SelectItem key={locale} value={locale}>
                  {locale.toUpperCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {template.configured ? (
          <Badge variant="accent">{t("versionBadge", { version: template.version })}</Badge>
        ) : (
          <Badge variant="neutral">{t("usingDefault")}</Badge>
        )}
        <span className="text-[12px] text-muted">{t("placeholderHint", { list: TEMPLATE_PLACEHOLDERS.map((p) => `{${p}}`).join("  ") })}</span>
      </div>

      <Alert tone="info">{t("blankMeansDefault")}</Alert>

      <Field id="template-subject" label={t("subject")}>
        <Input value={fields.subject} onChange={set("subject")} placeholder={defaults.subject} maxLength={200} />
      </Field>

      <Field id="template-preview" label={t("preview")} description={t("previewHint")}>
        <Input value={fields.preview} onChange={set("preview")} placeholder={defaults.preview} maxLength={200} />
      </Field>

      <Field id="template-heading" label={t("heading")}>
        <Input value={fields.heading} onChange={set("heading")} placeholder={defaults.heading} maxLength={200} />
      </Field>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="template-body" className="text-[12px] font-medium text-foreground">
          {t("body")}
        </label>
        <textarea
          id="template-body"
          value={fields.body}
          onChange={set("body")}
          placeholder={defaults.body}
          rows={6}
          maxLength={4000}
          className="w-full resize-y rounded-md border border-line bg-surface p-2.5 text-[13px] text-foreground placeholder:text-faint"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="template-action" label={t("actionLabel")}>
          <Input value={fields.actionLabel} onChange={set("actionLabel")} placeholder={defaults.actionLabel} maxLength={80} />
        </Field>
        <Field id="template-note" label={t("changeNote")} description={t("changeNoteHint")}>
          <Input value={changeNote} onChange={(event) => setChangeNote(event.target.value)} maxLength={200} />
        </Field>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="template-footnote" className="text-[12px] font-medium text-foreground">
          {t("footnote")}
        </label>
        <textarea
          id="template-footnote"
          value={fields.footnote}
          onChange={set("footnote")}
          placeholder={defaults.footnote}
          rows={2}
          maxLength={600}
          className="w-full resize-y rounded-md border border-line bg-surface p-2.5 text-[13px] text-foreground placeholder:text-faint"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <Button onClick={save} disabled={pending}>
          {pending ? <Spinner /> : <Save className="size-3.5" aria-hidden />}
          {t("save")}
        </Button>
        <Button variant="secondary" onClick={() => setShowHistory((open) => !open)} disabled={versions.length === 0}>
          <History className="size-3.5" aria-hidden />
          {t("history", { count: versions.length })}
        </Button>
        {template.configured ? (
          <Button variant="ghost" onClick={() => setConfirmReset(true)} disabled={pending}>
            <RotateCcw className="size-3.5" aria-hidden />
            {t("resetToDefault")}
          </Button>
        ) : null}
      </div>

      {showHistory ? (
        <ol className="flex flex-col divide-y divide-line rounded-md border border-line">
          {versions.map((entry) => (
            <li key={entry.version} className="flex flex-wrap items-start justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-foreground">
                  {t("versionBadge", { version: entry.version })}
                  {entry.version === template.version ? <Badge variant="success">{t("live")}</Badge> : null}
                  {entry.restoredFrom !== null ? (
                    <Badge variant="neutral">{t("restoredFrom", { version: entry.restoredFrom })}</Badge>
                  ) : null}
                </p>
                <p className="mt-0.5 truncate text-[12px] text-muted">{entry.subject || t("noSubject")}</p>
                {entry.changeNote ? (
                  <p className="mt-0.5 text-[12px] italic text-faint">{entry.changeNote}</p>
                ) : null}
                <p className="mt-0.5 text-[11px] text-faint">
                  {entry.authorName ?? t("systemAuthor")} · {new Date(entry.createdAt).toLocaleString()}
                </p>
              </div>
              {entry.version !== template.version ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={restoring !== null}
                  onClick={() => restore(entry.version)}
                >
                  {restoring === entry.version ? <Spinner /> : <Undo2 className="size-3.5" aria-hidden />}
                  {t("restore")}
                </Button>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={(next) => (pending ? undefined : setConfirmReset(next))}
        title={t("resetToDefault")}
        description={t("resetConfirm")}
        consequences={[t("resetConsequenceCopy"), t("resetConsequenceHistory")]}
        confirmLabel={t("resetToDefault")}
        cancelLabel={tc("cancel")}
        tone="danger"
        onConfirm={reset}
      />
    </div>
  );
}
