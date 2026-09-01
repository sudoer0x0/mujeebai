"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Megaphone, Eye, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Alert } from "@/components/ui/alert";
import { toast } from "@/components/ui/toast";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";
import { updateSystemSettingAction } from "@/app/[locale]/admin/settings/actions";

/**
 * Writes the platform announcement.
 *
 * ## Why Markdown rather than raw HTML
 *
 * Rich formatting was the requirement; raw HTML was the suggested means.
 * Markdown gets there through a pipeline that is already hardened — the
 * same `rehype-sanitize` configuration the chat uses — so a stray
 * `<script>`, an `onerror=` attribute or a `javascript:` link cannot reach
 * a reader even if one is pasted in.
 *
 * Accepting raw HTML would mean adding `rehype-raw` and then trusting a
 * sanitizer to undo it, on content shown to **every signed-in user**. The
 * blast radius of getting that wrong is the entire user base, and the
 * upside over Markdown is a few tags nobody has asked for yet.
 *
 * The preview renders through exactly the component readers see, so what
 * is previewed is what ships — including anything the sanitizer strips.
 */
export function AnnouncementEditor({ initial }: { initial: string }) {
  const t = useTranslations("admin.announcements");
  const router = useRouter();

  const [value, setValue] = React.useState(initial);
  const [pending, setPending] = React.useState(false);

  const dirty = value.trim() !== initial.trim();
  const live = initial.trim().length > 0;

  async function save(next: string | null) {
    setPending(true);
    try {
      const result = await updateSystemSettingAction({ key: "announcement", value: next });
      if (result.ok) {
        toast.success(next === null ? t("cleared") : t("published"));
        if (next === null) setValue("");
        router.refresh();
      } else {
        toast.error(t("failed"));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {live ? (
        <Alert tone="info">{t("liveNow")}</Alert>
      ) : (
        <p className="text-[13px] text-muted">{t("noneLive")}</p>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="announcement-body" className="text-[13px] font-medium text-foreground">
          {t("body")}
        </label>
        <textarea
          id="announcement-body"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          rows={5}
          maxLength={500}
          placeholder={t("placeholder")}
          className="scroll-area w-full resize-y rounded-md border border-line bg-surface px-3 py-2 text-[13px] leading-relaxed text-foreground placeholder:text-faint focus:border-line-strong focus:outline-none"
        />
        <p className="flex items-center justify-between text-[12px] text-faint">
          <span>{t("formattingHint")}</span>
          <span className="tabular-nums">{value.length}/500</span>
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
          <Eye className="size-3.5 text-muted" aria-hidden />
          {t("preview")}
        </p>

        {/* Rendered exactly as a reader sees it, banner chrome included —
            a preview in a different frame is a preview of something else. */}
        <div className="overflow-hidden rounded-md border border-line">
          {value.trim() ? (
            <div className="flex items-start gap-2.5 bg-accent-soft px-4 py-2.5 text-[13px] text-foreground">
              <Megaphone className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
              <div className="min-w-0 flex-1 [&_p]:m-0">
                <MarkdownRenderer content={value} />
              </div>
            </div>
          ) : (
            <p className="px-4 py-6 text-center text-[12px] text-faint">{t("previewEmpty")}</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        {live ? (
          <Button variant="ghost" onClick={() => save(null)} disabled={pending}>
            <Trash2 className="size-3.5" aria-hidden />
            {t("clear")}
          </Button>
        ) : null}
        <Button onClick={() => save(value.trim())} disabled={pending || !dirty || !value.trim()}>
          {pending ? <Spinner /> : null}
          {live ? t("update") : t("publish")}
        </Button>
      </div>
    </div>
  );
}
