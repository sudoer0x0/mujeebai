"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { History, Send, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import {
  publishSystemPromptAction,
  restoreSystemPromptVersionAction,
} from "@/app/[locale]/admin/system-prompt/actions";

export interface PromptVersion {
  id: string;
  version: number;
  status: string;
  createdAt: string;
  publishedAt: string | null;
  author: string | null;
  preview: string;
}

/**
 * System-prompt editor with version history.
 *
 * Publishing is behind a confirmation because this string is prepended to
 * every conversation for every user on every model — it is the single
 * highest-blast-radius text field in the product, and there is no
 * per-user rollout to catch a mistake.
 */
export function PromptEditor({
  locale,
  activeVersion,
  initialContent,
  history,
}: {
  locale: string;
  activeVersion: number;
  initialContent: string;
  history: PromptVersion[];
}) {
  const t = useTranslations("admin.systemPrompt");
  const tc = useTranslations("admin.common");

  const [content, setContent] = React.useState(initialContent);
  const [pending, setPending] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [restoring, setRestoring] = React.useState<string | null>(null);

  const dirty = content.trim() !== initialContent.trim();
  const empty = content.trim().length === 0;

  async function publish() {
    setPending(true);
    try {
      const result = await publishSystemPromptAction({ content });
      if (result.ok) toast.success(t("published", { version: result.count ?? activeVersion + 1 }));
      else toast.error(tc("actionFailed"));
    } finally {
      setPending(false);
    }
  }

  async function restore(id: string) {
    setRestoring(id);
    try {
      const result = await restoreSystemPromptVersionAction(id);
      if (result.ok) toast.success(t("restored"));
      else toast.error(tc("actionFailed"));
    } finally {
      setRestoring(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2">
          <CardTitle>{t("editor")}</CardTitle>
          <Badge variant="accent">{t("active", { version: activeVersion })}</Badge>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={14}
            maxLength={20_000}
            spellCheck={false}
            aria-label={t("editor")}
            className="font-mono text-[12px] leading-relaxed"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] tabular-nums text-faint">{content.length.toLocaleString(locale)} / 20,000</span>
            <Button disabled={!dirty || empty || pending} onClick={() => setConfirming(true)}>
              {pending ? <Spinner /> : <Send />}
              {t("publish")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center gap-2">
          <History className="size-3.5 text-muted" aria-hidden />
          <CardTitle>{t("history")}</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-line py-0">
          {history.map((version) => (
            <div key={version.id} className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-foreground">v{version.version}</span>
                  {version.status === "active" ? <Badge variant="success">{version.status}</Badge> : null}
                  {version.author ? (
                    <span className="text-[12px] text-faint">{t("by", { name: version.author })}</span>
                  ) : null}
                </div>
                <p className="mt-1 line-clamp-2 font-mono text-[11px] leading-relaxed text-muted">{version.preview}…</p>
                <p className="mt-1 text-[11px] text-faint tabular-nums">
                  {new Date(version.publishedAt ?? version.createdAt).toLocaleString(locale)}
                </p>
              </div>
              {version.status !== "active" ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={restoring !== null}
                  onClick={() => restore(version.id)}
                >
                  {restoring === version.id ? <Spinner /> : <Undo2 />}
                  {t("restore")}
                </Button>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        tone="primary"
        title={t("confirmTitle")}
        description={t("confirmBody")}
        confirmLabel={t("publish")}
        cancelLabel={tc("cancel")}
        onConfirm={publish}
      />
    </div>
  );
}
