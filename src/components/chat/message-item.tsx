"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Copy, Check, RefreshCw, Pencil, ChevronDown, X } from "lucide-react";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";
import { MessageAttachments } from "@/components/chat/message-attachments";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { displayContentOf, type UiMessage } from "@/components/chat/types";
import { cn } from "@/lib/utils";

export function MessageItem({
  message,
  onRegenerate,
  onEdit,
  onSelectVariant,
}: {
  message: UiMessage;
  onRegenerate?: (messageId: string) => void;
  onEdit?: (messageId: string, newContent: string) => void;
  onSelectVariant?: (messageId: string, index: number) => void;
}) {
  const t = useTranslations("chat");
  const [copied, setCopied] = React.useState(false);
  const [showReasoning, setShowReasoning] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");

  const isUser = message.role === "user";
  const variants = message.variants ?? [];
  const activeIndex = message.activeVariantIndex ?? Math.max(0, variants.length - 1);
  const displayContent = displayContentOf(message);
  const isBusy = message.status === "pending" || message.status === "streaming";

  // A local id means the message exists only in this tab and the server
  // has no row to act on yet, so regenerate/edit must stay unavailable.
  const isPersisted = !message.id.startsWith("local-");

  async function handleCopy() {
    if (!displayContent) return;
    try {
      await navigator.clipboard.writeText(displayContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied (insecure context, permissions).
      // The button simply does not confirm; nothing is broken.
    }
  }

  function startEditing() {
    setDraft(displayContent ?? "");
    setEditing(true);
  }

  function submitEdit() {
    const next = draft.trim();
    if (!next || next === displayContent) {
      setEditing(false);
      return;
    }
    onEdit?.(message.id, next);
    setEditing(false);
  }

  if (message.role === "system") return null;

  return (
    <article
      className={cn("group flex w-full flex-col gap-1.5 py-4", isUser ? "items-end" : "items-start")}
      aria-label={isUser ? t("a11y.yourMessage") : t("a11y.assistantMessage")}
    >
      {isUser && editing ? (
        <div className="w-full max-w-[46rem]">
          <Textarea
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setEditing(false);
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submitEdit();
            }}
            rows={3}
            aria-label={t("edit")}
            className="text-[14px]"
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              <X />
              {t("cancel")}
            </Button>
            <Button size="sm" onClick={submitEdit} disabled={!draft.trim()}>
              {t("saveAndResend")}
            </Button>
          </div>
        </div>
      ) : (
        // No assistant avatar: a repeated single-letter badge down the left
        // edge adds a column of noise without identifying anything the user
        // did not already know. Replies start flush with the conversation,
        // which also gives long answers more room.
        <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
          <div
            className={cn(
              "min-w-0 text-[14px] leading-[1.65]",
              isUser
                ? "max-w-[36rem] rounded-3xl bg-surface-raised px-4 py-2.5 text-foreground"
                : "flex-1",
            )}
          >
            {message.status === "error" ? (
              <Alert tone="danger">{t("errorGeneric")}</Alert>
            ) : isBusy && !displayContent && !(message.attachments ?? []).length ? (
              <p className="pulse text-[13px] text-muted" role="status">
                {t("generating")}
              </p>
            ) : (
              <>
                {!isUser && message.reasoning ? (
                  <div className="mb-3">
                    <button
                      type="button"
                      onClick={() => setShowReasoning((value) => !value)}
                      aria-expanded={showReasoning}
                      className="inline-flex items-center gap-1.5 rounded-sm border border-line bg-surface px-2 py-1 text-[12px] text-muted transition-colors hover:text-foreground"
                    >
                      <span>{t("thinking")}</span>
                      <ChevronDown
                        className={cn("size-3 transition-transform", showReasoning && "rotate-180")}
                        aria-hidden
                      />
                    </button>
                    {showReasoning ? (
                      <div className="mt-2 whitespace-pre-wrap rounded-md border border-line bg-surface-raised p-3 text-[13px] leading-relaxed text-muted">
                        {message.reasoning}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {isUser ? (
                  <>
                    {displayContent ? (
                      <p className="whitespace-pre-wrap break-words">{displayContent}</p>
                    ) : null}
                    <MessageAttachments attachments={message.attachments ?? []} />
                  </>
                ) : (
                  <MarkdownRenderer
                    content={displayContent ?? ""}
                    // The caret marks the live tail of a streaming reply.
                    className={message.status === "streaming" ? "streaming-caret" : undefined}
                  />
                )}

                {message.status === "stopped" ? (
                  <p className="mt-2 text-[12px] text-faint">{t("stopped")}</p>
                ) : null}
              </>
            )}
          </div>
        </div>
      )}

      {/* The action bar is revealed on hover *and* on keyboard focus —
          `group-hover` alone hides these controls from keyboard users
          entirely. It stays hidden while a reply is still streaming. */}
      {!isBusy && !editing ? (
        <div
          className={cn(
            "flex items-center gap-0.5 transition-opacity focus-within:opacity-100",
            // Assistant controls stay visible: copy and regenerate are the
            // two things people reach for most, and hiding them behind a
            // hover makes them undiscoverable on touch, where there is no
            // hover at all.
            isUser
              ? "justify-end opacity-0 group-hover:opacity-100"
              : "justify-start opacity-100",
          )}
        >
          {!isUser && variants.length > 1 ? (
            <div className="me-1 flex items-center gap-0.5 text-[12px] tabular-nums text-muted">
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={activeIndex <= 0}
                onClick={() => onSelectVariant?.(message.id, activeIndex - 1)}
                aria-label={t("previousVariant")}
              >
                <ChevronLeft className="rtl:rotate-180" />
              </Button>
              <span>{t("variantOf", { current: activeIndex + 1, total: variants.length })}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={activeIndex >= variants.length - 1}
                onClick={() => onSelectVariant?.(message.id, activeIndex + 1)}
                aria-label={t("nextVariant")}
              >
                <ChevronRight className="rtl:rotate-180" />
              </Button>
            </div>
          ) : null}

          <IconAction label={copied ? t("copied") : t("copy")} onClick={handleCopy}>
            {copied ? <Check className="text-success" /> : <Copy />}
          </IconAction>

          {!isUser && onRegenerate && isPersisted ? (
            <IconAction label={t("regenerate")} onClick={() => onRegenerate(message.id)}>
              <RefreshCw />
            </IconAction>
          ) : null}

          {isUser && onEdit && isPersisted ? (
            <IconAction label={t("edit")} onClick={startEditing}>
              <Pencil />
            </IconAction>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" onClick={onClick} aria-label={label}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
