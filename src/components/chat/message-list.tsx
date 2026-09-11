"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { MessageItem } from "@/components/chat/message-item";
import { DateSeparator } from "@/components/chat/date-separator";
import { formatDateSeparator, shouldShowDateSeparator } from "@/lib/date";
import type { UiMessage } from "@/components/chat/types";

const SUGGESTION_KEYS = ["explain", "draft", "analyze", "brainstorm"] as const;

export function MessageList({
  messages,
  onRegenerate,
  onEdit,
  onSelectVariant,
  onSelectPrompt,
}: {
  messages: UiMessage[];
  onRegenerate?: (messageId: string) => void;
  onEdit?: (messageId: string, newContent: string) => void;
  onSelectVariant?: (messageId: string, index: number) => void;
  onSelectPrompt?: (prompt: string) => void;
}) {
  const t = useTranslations("chat");
  const locale = useLocale();
  const dateTranslations = React.useMemo(
    () => ({
      today: t("date.today"),
      yesterday: t("date.yesterday"),
    }),
    [t],
  );
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [pinnedToBottom, setPinnedToBottom] = React.useState(true);

  const last = messages[messages.length - 1];

  /**
   * Auto-scroll, but only while the user is already at the bottom.
   *
   * Unconditionally scrolling on every token yanks the view away from
   * anyone who has scrolled up to re-read an earlier answer while a new
   * one streams in — a small detail that makes long conversations
   * genuinely unusable.
   */
  React.useEffect(() => {
    const scroller = containerRef.current?.closest("[data-chat-scroll]");
    if (!scroller) return;

    function onScroll() {
      const element = scroller as HTMLElement;
      const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
      setPinnedToBottom(distance < 120);
    }

    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, []);

  React.useEffect(() => {
    if (pinnedToBottom) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, last?.content, last?.status, pinnedToBottom]);

  if (messages.length === 0) {
    const suggestions = SUGGESTION_KEYS.map((key) => ({
      key,
      title: t(`suggestions.${key}.title` as never),
      prompt: t(`suggestions.${key}.prompt` as never),
    }));

    return (
      <div className="mx-auto flex h-full w-full max-w-2xl flex-col justify-center px-4 py-12">
        <h1 className="text-center text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          {t("empty.title")}
        </h1>
        <p className="mt-2 text-center text-[13px] text-muted">{t("empty.subtitle")}</p>

        <div className="mt-8 grid gap-2 sm:grid-cols-2">
          {suggestions.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => onSelectPrompt?.(item.prompt)}
              className="rounded-md border border-line bg-surface px-3.5 py-3 text-start transition-colors hover:border-line-strong hover:bg-surface-raised"
            >
              <span className="block text-[13px] font-medium text-foreground">{item.title}</span>
              <span className="mt-0.5 block line-clamp-2 text-[12px] leading-relaxed text-muted">{item.prompt}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="mx-auto flex w-full max-w-3xl flex-col px-4 py-2">
      {/* Streaming replies land here for assistive tech. `polite` so a
          screen reader finishes the current utterance first rather than
          interrupting on every token. */}
      <div aria-live="polite" aria-atomic="false" className="contents">
        {messages.map((message, index) => {
          const prevMessage = index > 0 ? messages[index - 1] : undefined;
          const showSeparator = shouldShowDateSeparator(message.createdAt, prevMessage?.createdAt);
          const dateLabel =
            showSeparator && message.createdAt
              ? formatDateSeparator(message.createdAt, locale, dateTranslations)
              : "";

          return (
            <React.Fragment key={message.id}>
              {showSeparator && dateLabel ? (
                <DateSeparator label={dateLabel} date={message.createdAt} />
              ) : null}
              <MessageItem
                message={message}
                onRegenerate={onRegenerate}
                onEdit={onEdit}
                onSelectVariant={onSelectVariant}
              />
            </React.Fragment>
          );
        })}
      </div>
      <div ref={bottomRef} className="h-2" />
    </div>
  );
}
