import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireUser } from "@/auth/session";
import { ChatView } from "@/components/chat/chat-view";
import { loadChatCapabilities } from "@/ai/capabilities";
import { loadConversationMessages } from "@/chat/messages";

async function loadConversation(conversationId: string) {
  const user = await requireUser().catch(() => null);
  if (!user) return null;

  const supabase = await createServerSupabaseClient();

  // RLS already scopes this to the owner; the explicit user_id keeps the
  // intent visible and makes the 404 the right answer for someone else's
  // conversation id rather than an empty page.
  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, title, model_id, models(slug)")
    .eq("id", conversationId)
    .eq("user_id", user.id)
    .maybeSingle<{ id: string; title: string; model_id: string | null; models: { slug: string } | null }>();

  return conversation;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}): Promise<Metadata> {
  const { conversationId } = await params;
  const conversation = await loadConversation(conversationId);
  return { title: conversation?.title ?? "Chat" };
}

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ locale: string; conversationId: string }>;
}) {
  const { locale, conversationId } = await params;
  setRequestLocale(locale);

  const conversation = await loadConversation(conversationId);
  if (!conversation) notFound();

  const messages = await loadConversationMessages(conversationId);

  const capabilities = await loadChatCapabilities();

  return (
    <ChatView
      conversationId={conversation.id}
      initialMessages={messages as never}
      initialModelSlug={conversation.models?.slug ?? null}
      {...capabilities}
    />
  );
}
