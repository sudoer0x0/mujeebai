"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Copy, Check, RefreshCw, Pencil, ChevronDown, X, Brain } from "lucide-react";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";
import { MessageAttachments } from "@/components/chat/message-attachments";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { displayContentOf, type UiMessage } from "@/components/chat/types";
import { formatMessageTime } from "@/lib/date";
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
  const locale = useLocale();
  const [copied, setCopied] = React.useState(false);
  const [showReasoning, setShowReasoning] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");

  const isUser = message.role === "user";
  const variants = message.variants ?? [];
  const activeIndex = message.activeVariantIndex ?? Math.max(0, variants.length - 1);
  const displayContent = displayContentOf(message);
  const isBusy = message.status === "pending" || message.status === "streaming";
  const timeString = React.useMemo(
    () => formatMessageTime(message.createdAt, locale),
    [message.createdAt, locale],
  );

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
      data-role={message.role}
      className={cn(
        "group flex w-full flex-col",
        isUser
          ? "items-end pt-3.5 pb-1 sm:pt-4 sm:pb-1.5"
          : "items-start pt-1 pb-3.5 sm:pt-1.5 sm:pb-4",
      )}
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
        // User and assistant rows: user actions sit beside the user bubble to consume
        // zero vertical height below the bubble, dramatically reducing input-output distance.
        <div className={cn("flex w-full items-end gap-1.5", isUser ? "justify-end" : "justify-start")}>
          {isUser && !isBusy && !editing ? (
            <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
              <IconAction label={copied ? t("copied") : t("copy")} onClick={handleCopy}>
                {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
              </IconAction>
              {onEdit && isPersisted ? (
                <IconAction label={t("edit")} onClick={startEditing}>
                  <Pencil className="size-3.5" />
                </IconAction>
              ) : null}
            </div>
          ) : null}

          <div
            className={cn(
              "min-w-0 text-[14px] leading-[1.65]",
              isUser
                ? "max-w-[36rem] rounded-3xl bg-surface-raised px-4 py-2.5 text-foreground"
                : "flex-1",
            )}
          >
            {message.status === "error" && !displayContent ? (
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
                    {message.createdAt && timeString ? (
                      <div className="mt-1 flex items-center justify-end">
                        <time
                          dateTime={message.createdAt}
                          suppressHydrationWarning
                          className="text-[11px] text-muted/75 tabular-nums select-none"
                        >
                          {timeString}
                        </time>
                      </div>
                    ) : null}
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
                ) : message.status === "error" && displayContent ? (
                  <p className="mt-2 text-[12px] text-danger">{t("errorGeneric")}</p>
                ) : null}
              </>
            )}
          </div>
        </div>
      )}

      {/* Assistant action bar (variant switcher, copy, regenerate, memory) and timestamp */}
      {!isUser && !isBusy && (
        <div className="flex w-full items-center justify-between pt-1 text-muted">
          <div className="flex items-center gap-0.5">
            {variants.length > 1 ? (
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

            {onRegenerate && isPersisted ? (
              <IconAction label={t("regenerate")} onClick={() => onRegenerate(message.id)}>
                <RefreshCw />
              </IconAction>
            ) : null}

            {message.savedMemories && message.savedMemories.length > 0 ? (
              <MemoryAction memories={message.savedMemories} />
            ) : null}
          </div>

          {message.createdAt && timeString ? (
            <time
              dateTime={message.createdAt}
              suppressHydrationWarning
              className="text-[11px] text-muted/65 tabular-nums select-none ms-auto"
            >
              {timeString}
            </time>
          ) : null}
        </div>
      )}
    </article>
  );
}

function MemoryAction({
  memories,
}: {
  memories: Array<{ id?: string; category: string; content: string }>;
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="relative text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10 transition-transform active:scale-95"
              aria-label="Information saved to memory"
            >
              <Brain className="size-4" />
              <span className="absolute -top-0.5 -end-0.5 flex size-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full size-2 bg-emerald-500"></span>
              </span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Information saved to memory</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-80 p-2.5 text-[13px]">
        <div className="flex items-center gap-1.5 px-1 py-1 font-semibold text-foreground text-[12px]">
          <Brain className="size-4 text-emerald-500" />
          <span>Saved to Memory</span>
        </div>
        <DropdownMenuSeparator className="my-1.5" />
        <div className="flex flex-col gap-1.5 py-1">
          {memories.map((m, idx) => (
            <div
              key={m.id || idx}
              className="flex flex-col gap-0.5 rounded-md bg-surface-raised/70 p-2 text-[12px] leading-snug border border-line"
            >
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                {m.category}
              </span>
              <span className="text-foreground">{m.content}</span>
            </div>
          ))}
        </div>
        <DropdownMenuSeparator className="my-1.5" />
        <div className="px-1 pt-0.5 text-center">
          <Link
            href="/settings"
            className="text-[11px] text-muted hover:text-foreground underline underline-offset-2 transition-colors"
          >
            Manage memories in Settings &rarr;
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
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
