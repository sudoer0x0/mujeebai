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
  return <ChatView {...capabilities} />;
}
