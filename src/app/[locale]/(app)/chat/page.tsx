import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ChatView } from "@/components/chat/chat-view";
import { loadChatCapabilities } from "@/ai/capabilities";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "nav" });
  return { title: t("newChat") };
}

export default async function NewChatPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const capabilities = await loadChatCapabilities();
  // `key` is what resets the view between conversations.
  //
  // ChatView used to do it in an effect, comparing the incoming
  // `conversationId` prop against what it was showing. That could not
  // work: when a reply creates a conversation the id is adopted with
  // `history.replaceState`, which deliberately does not navigate — so the
  // prop stays `undefined`, and the next re-render looked like a
  // navigation away and wiped the reply off the screen.
  //
  // A key has none of that ambiguity. A real navigation changes it and
  // React remounts with the right messages; `replaceState` does not
  // change it and the live conversation is left alone.
  return <ChatView key="new" {...capabilities} />;
}
