"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { MessageList } from "@/components/chat/message-list";
import { Composer } from "@/components/chat/composer";
import { toast } from "@/components/ui/toast";
import { readEventStream, STREAM_END } from "@/lib/streaming";
import { activeVariantIndexOf, type UiAttachment, type UiMessage, type UiMessageVariant } from "@/components/chat/types";

interface RawMessage {
  id: string;
  role: "user" | "assistant" | "system";
  status: UiMessage["status"];
  content: string | null;
  message_variants?: Array<{
    id: string;
    sequence: number;
    content: string | null;
    reasoning_summary: string | null;
    finish_reason: string | null;
    error: { code: string; message: string } | null;
  }>;
  active_variant_id?: string | null;
  attachments?: UiAttachment[];
}

function mapRawMessage(raw: RawMessage): UiMessage {
  const variants = (raw.message_variants ?? []).sort((a, b) => a.sequence - b.sequence);
  const activeIndex = variants.findIndex((variant) => variant.id === raw.active_variant_id);
  const resolvedIndex = activeIndex >= 0 ? activeIndex : Math.max(0, variants.length - 1);

  return {
    id: raw.id,
    role: raw.role,
    status: raw.status,
    content: raw.content,
    variants,
    activeVariantIndex: variants.length ? resolvedIndex : undefined,
    attachments: raw.attachments ?? [],
    reasoning: variants[resolvedIndex]?.reasoning_summary ?? null,
  };
}

/**
 * Mirrors streamed text into the message's active variant.
 *
 * `MessageItem` prefers the active variant's content when one exists, so
 * a stream that only updates `message.content` is invisible on any
 * message that already has variants — which is every regeneration.
 */
/**
 * Puts the conversation id in the address bar without navigating.
 *
 * `history.replaceState` is deliberate: a real navigation would remount
 * the chat and throw away the reply currently streaming into it. But the
 * URL it writes has to remain a URL this app actually serves — and the
 * previous version wrote `/chat/<id>`, dropping the `/{locale}` prefix
 * every route in this application is mounted under.
 *
 * The result was the bug this fixes: the address bar no longer matched
 * any route, so the next render resolved to a fresh empty chat. The
 * message that had just been sent vanished, and it looked as though
 * sending had opened a new conversation.
 *
 * The locale is read from the current path rather than passed in, so
 * this cannot drift out of step with wherever the app is actually
 * mounted.
 */
function replaceConversationUrl(conversationId: string) {
  if (typeof window === "undefined") return;

  const [, maybeLocale] = window.location.pathname.split("/");
  const prefix = /^[a-z]{2}$/.test(maybeLocale ?? "") ? `/${maybeLocale}` : "";

  window.history.replaceState(null, "", `${prefix}/chat/${conversationId}`);
}

function withActiveVariantContent(message: UiMessage, text: string): Partial<UiMessage> {
  // Resolved the same way the renderer resolves it. Previously this
  // required an explicit `activeVariantIndex` and gave up otherwise —
  // but the renderer falls back to the last variant, so on a fresh reply
  // the text was written to `message.content` while the screen was
  // reading an empty variant.
  const index = activeVariantIndexOf(message);
  if (index === null) return {};

  const variants = [...(message.variants ?? [])];
  variants[index] = { ...variants[index], content: text };
  return { variants };
}

export function ChatView({
  conversationId: initialConversationId,
  initialMessages = [],
  initialModelSlug = null,
  imageGenerationEnabled,
  fileUploadsEnabled,
  maxFileSizeMb,
  maxAttachments,
}: {
  conversationId?: string;
  initialMessages?: RawMessage[];
  initialModelSlug?: string | null;
  imageGenerationEnabled: boolean;
  fileUploadsEnabled: boolean;
  maxFileSizeMb: number;
  maxAttachments: number;
}) {
  const t = useTranslations("chat");
  const tNav = useTranslations("nav");
  const tRoot = useTranslations();

  const [conversationId, setConversationId] = React.useState(initialConversationId);
  const [messages, setMessages] = React.useState<UiMessage[]>(() => initialMessages.map(mapRawMessage));
  const [modelSlug, setModelSlug] = React.useState<string | null>(initialModelSlug);
  const [isStreaming, setIsStreaming] = React.useState(false);
  const [composerKey, setComposerKey] = React.useState(0);
  const abortRef = React.useRef<AbortController | null>(null);

  const currentConvIdRef = React.useRef(initialConversationId);

  // Listen for instant new-chat events dispatched from the sidebar, header, or rail.
  // Resets local messages, aborts any active stream, resets composer draft, and updates
  // browser URL and title without requiring a full page reload or waiting for network roundtrips.
  React.useEffect(() => {
    function onNewChat() {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      setIsStreaming(false);

      currentConvIdRef.current = undefined;
      setConversationId(undefined);
      setMessages([]);
      setComposerKey((k) => k + 1);

      if (typeof window !== "undefined") {
        const [, maybeLocale] = window.location.pathname.split("/");
        const prefix = /^[a-z]{2}$/.test(maybeLocale ?? "") ? `/${maybeLocale}` : "";
        const targetUrl = `${prefix}/chat`;
        if (window.location.pathname !== targetUrl) {
          window.history.pushState(null, "", targetUrl);
        }
        document.title = `${tNav("newChat")} · Mujeeb AI`;
        const scroller = document.querySelector("[data-chat-scroll]");
        if (scroller) scroller.scrollTop = 0;
      }
    }

    window.addEventListener("mujeeb:new-chat", onNewChat);
    return () => {
      window.removeEventListener("mujeeb:new-chat", onNewChat);
    };
  }, [tNav]);

  // No re-seeding effect. The parent keys this component by conversation
  // id, so React remounts it on a real navigation and leaves it entirely
  // alone when a conversation id is adopted mid-stream. Every previous
  // attempt to work this out from props or from the pathname got one of
  // those two cases wrong.

  /** Translates a server-sent message key, falling back to a generic one. */
  const translateServerError = React.useCallback(
    (key: string | undefined): string => {
      if (!key) return t("errorGeneric");
      try {
        return tRoot(key as never);
      } catch {
        return t("errorGeneric");
      }
    },
    [t, tRoot],
  );

  const runStream = React.useCallback(
    async (endpoint: string, body: Record<string, unknown>, assistantMessageId: string) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);

      let settledMessageId = assistantMessageId;

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const data = await response.json().catch(() => ({}));
          toast.error(translateServerError(data.error));
          setMessages((previous) =>
            previous.map((message) =>
              message.id === assistantMessageId ? { ...message, status: "error" } : message,
            ),
          );
          return;
        }

        const newConversationId = response.headers.get("X-Conversation-Id");
        const serverMessageId = response.headers.get("X-Message-Id");

        // Swap the optimistic local id for the server's, so regenerate and
        // edit work on this message without a page reload.
        if (serverMessageId && serverMessageId !== assistantMessageId) {
          settledMessageId = serverMessageId;
          setMessages((previous) =>
            previous.map((message) =>
              message.id === assistantMessageId ? { ...message, id: serverMessageId } : message,
            ),
          );
        }

        if (newConversationId && newConversationId !== conversationId) {
          currentConvIdRef.current = newConversationId;
          setConversationId(newConversationId);
          replaceConversationUrl(newConversationId);
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("mujeeb:conversations-changed"));
          }
        }

        let text = "";
        let reasoning = "";

        let sawEnd = false;

        for await (const chunk of readEventStream(response.body)) {
          // The server's explicit terminator. Reaching it means the model
          // finished, as distinct from the connection simply going quiet —
          // which is what left the caret blinking on a dropped stream.
          if (chunk === STREAM_END) {
            sawEnd = true;
            continue;
          }

          if (chunk.type === "delta") {
            text += chunk.text;
            setMessages((previous) =>
              previous.map((message) =>
                message.id === settledMessageId || message.id === assistantMessageId
                  ? { ...message, id: settledMessageId, content: text, status: "streaming", ...withActiveVariantContent(message, text) }
                  : message,
              ),
            );
          } else if (chunk.type === "reasoning_delta") {
            reasoning += chunk.text;
            setMessages((previous) =>
              previous.map((message) =>
                message.id === settledMessageId || message.id === assistantMessageId ? { ...message, id: settledMessageId, reasoning } : message,
              ),
            );
          } else if (chunk.type === "done") {
            setMessages((previous) =>
              previous.map((message) =>
                message.id === settledMessageId || message.id === assistantMessageId
                  ? {
                      ...message,
                      id: settledMessageId,
                      content: text || message.content,
                      status: "complete",
                      ...withActiveVariantContent(message, text || message.content || ""),
                    }
                  : message,
              ),
            );
          } else if (chunk.type === "error") {
            toast.error(translateServerError(`chat.gatewayError.${chunk.code}`));
            setMessages((previous) =>
              previous.map((message) =>
                message.id === settledMessageId || message.id === assistantMessageId ? { ...message, id: settledMessageId, status: "error" } : message,
              ),
            );
          }
        }

        // Settle the message once the body is exhausted.
        //
        // `sawEnd` distinguishes a reply the server said was finished from
        // a connection that merely stopped producing bytes. Both used to
        // be treated as "complete", so a dropped stream left a
        // half-written answer looking authoritative — and a stream that
        // ended without the client noticing left the caret blinking on a
        // message the model had long since finished.
        setMessages((previous) =>
          previous.map((message) =>
            (message.id === settledMessageId || message.id === assistantMessageId) && message.status === "streaming"
              ? {
                  ...message,
                  id: settledMessageId,
                  content: text || message.content,
                  status: sawEnd ? "complete" : text ? "stopped" : "error",
                  ...withActiveVariantContent(message, text || message.content || ""),
                }
              : message,
          ),
        );

        if (!sawEnd && !text) toast.error(t("errorGeneric"));
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          // Stopped deliberately: keep whatever streamed in, mark it as
          // stopped rather than failed.
          setMessages((previous) =>
            previous.map((message) =>
              (message.id === settledMessageId || message.id === assistantMessageId) && message.status !== "complete"
                ? { ...message, id: settledMessageId, status: "stopped" }
                : message,
            ),
          );
        } else {
          toast.error(t("errorGeneric"));
          setMessages((previous) =>
            previous.map((message) =>
              message.id === settledMessageId || message.id === assistantMessageId ? { ...message, id: settledMessageId, status: "error" } : message,
            ),
          );
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [conversationId, t, translateServerError],
  );

  function handleSend(content: string, attachments: UiAttachment[] = []) {
    const stamp = Date.now();
    const assistantMessageId = `local-assistant-${stamp}`;

    setMessages((previous) => [
      ...previous,
      // Carry the attachments onto the optimistic message. Without this
      // an uploaded image simply vanished the moment it was sent: the
      // composer cleared its chips and nothing in the transcript showed
      // what had been attached.
      { id: `local-user-${stamp}`, role: "user", status: "complete", content, attachments },
      { id: assistantMessageId, role: "assistant", status: "pending", content: null },
    ]);

    void runStream(
      "/api/chat",
      {
        conversationId,
        content,
        modelSlug: modelSlug ?? undefined,
        attachmentIds: attachments.map((attachment) => attachment.id),
      },
      assistantMessageId,
    );
  }

  /**
   * Regenerates an assistant reply.
   *
   * The server appends a *new* variant, so the client has to do the same
   * — otherwise `activeVariantIndex` keeps pointing at the previous
   * variant and `MessageItem` renders its stale text, which made the
   * regenerate button look completely dead even though the request
   * succeeded and a second variant was written.
   */
  /**
   * Matches an assistant message that is a generated image.
   *
   * Generated images are stored as `![prompt](/api/assets/<id>)`, which is
   * how a regeneration can tell what produced the message it is replacing.
   */
  const GENERATED_IMAGE = /^!\[[^\]]*\]\(\/api\/assets\/[0-9a-f-]+\)\s*$/i;

  function handleRegenerate(messageId: string) {
    const index = messages.findIndex((message) => message.id === messageId);
    const target = index === -1 ? null : messages[index];

    // Regenerating an image must go back to the image model.
    //
    // This used to call /api/chat/regenerate unconditionally, so asking
    // for another image handed the prompt to a *text* model, which
    // answered in prose. The message itself says which it was: an image
    // reply is the markdown image and nothing else.
    const active = target?.variants?.[target.activeVariantIndex ?? 0]?.content ?? target?.content ?? "";

    if (target && GENERATED_IMAGE.test(active.trim())) {
      // The prompt is the user message immediately before it.
      const prompt = [...messages.slice(0, index)].reverse().find((m) => m.role === "user")?.content;
      if (prompt) {
        void handleGenerateImage(prompt);
        return;
      }
    }

    setMessages((previous) =>
      previous.map((message) => {
        if (message.id !== messageId) return message;

        const variants = message.variants ?? [];
        const placeholder: UiMessageVariant = {
          id: `local-variant-${Date.now()}`,
          sequence: variants.length + 1,
          content: null,
          reasoning_summary: null,
          finish_reason: null,
          error: null,
        };

        return {
          ...message,
          status: "pending",
          content: null,
          reasoning: null,
          variants: [...variants, placeholder],
          activeVariantIndex: variants.length,
        };
      }),
    );

    void runStream("/api/chat/regenerate", { messageId, modelSlug: modelSlug ?? undefined }, messageId);
  }

  /**
   * Edits a user message in place and re-answers from that point.
   *
   * The tail of the conversation is dropped optimistically to match what
   * the server does, so the transcript never briefly shows the old answer
   * underneath the edited question.
   */
  function handleEdit(messageId: string, newContent: string) {
    const index = messages.findIndex((message) => message.id === messageId);
    if (index === -1) return;

    const assistantMessageId = `local-assistant-${Date.now()}`;

    setMessages((previous) => [
      ...previous.slice(0, index),
      { ...previous[index], content: newContent },
      { id: assistantMessageId, role: "assistant", status: "pending", content: null },
    ]);

    void runStream(
      "/api/chat/edit",
      { messageId, content: newContent, modelSlug: modelSlug ?? undefined },
      assistantMessageId,
    );
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  function handleSelectVariant(messageId: string, index: number) {
    setMessages((previous) =>
      previous.map((message) => {
        if (message.id !== messageId || !message.variants?.length) return message;
        const bounded = Math.max(0, Math.min(index, message.variants.length - 1));
        const variant = message.variants[bounded];
        return {
          ...message,
          activeVariantIndex: bounded,
          content: variant?.content ?? message.content,
          reasoning: variant?.reasoning_summary ?? null,
        };
      }),
    );
  }

  async function handleGenerateImage(prompt: string) {
    const stamp = Date.now();
    const placeholderId = `local-image-${stamp}`;

    setMessages((previous) => [
      ...previous,
      { id: `local-image-prompt-${stamp}`, role: "user", status: "complete", content: prompt },
      { id: placeholderId, role: "assistant", status: "pending", content: null },
    ]);

    setIsStreaming(true);
    try {
      const response = await fetch("/api/images/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, conversationId }),
      });
      const data = await response.json();

      if (!response.ok) {
        toast.error(translateServerError(data.error));
        setMessages((previous) =>
          previous.map((message) => (message.id === placeholderId ? { ...message, status: "error" } : message)),
        );
        return;
      }

      if (data.conversationId && data.conversationId !== conversationId) {
        currentConvIdRef.current = data.conversationId;
        setConversationId(data.conversationId);
        replaceConversationUrl(data.conversationId);
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("mujeeb:conversations-changed"));
        }
      }

      setMessages((previous) =>
        previous.map((message) =>
          message.id === placeholderId
            ? {
                ...message,
                id: data.messageId ?? placeholderId,
                status: "complete",
                // `data.url` is a stable /api/assets/<id> path, not an
                // expiring signed URL — see that route for why.
                content: `![${prompt.replace(/[[\]]/g, "")}](${data.url})`,
              }
            : message,
        ),
      );
    } catch {
      setMessages((previous) =>
        previous.map((message) => (message.id === placeholderId ? { ...message, status: "error" } : message)),
      );
      toast.error(t("errorGeneric"));
    } finally {
      setIsStreaming(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div data-chat-scroll className="scroll-area min-h-0 flex-1 overflow-y-auto">
        <MessageList
          messages={messages}
          onRegenerate={handleRegenerate}
          onEdit={handleEdit}
          onSelectVariant={handleSelectVariant}
          onSelectPrompt={(prompt) => handleSend(prompt)}
        />
      </div>
      <Composer
        key={composerKey}
        isStreaming={isStreaming}
        onSend={handleSend}
        onStop={handleStop}
        onGenerateImage={handleGenerateImage}
        modelSlug={modelSlug}
        onModelChange={setModelSlug}
        imageGenerationEnabled={imageGenerationEnabled}
        fileUploadsEnabled={fileUploadsEnabled}
        maxFileSizeMb={maxFileSizeMb}
        maxAttachments={maxAttachments}
      />
    </div>
  );
}
