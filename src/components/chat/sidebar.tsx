"use client";

import * as React from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import {
  MessageSquarePlus,
  Search,
  Settings,
  LogOut,
  MoreHorizontal,
  Pin,
  PinOff,
  Archive,
  Trash2,
  Menu,
  Pencil,
  CreditCard,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, initialsFor } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { RenameDialog } from "@/components/chat/rename-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeToggle } from "@/components/marketing/theme-toggle";
import { LanguageSwitcher } from "@/components/marketing/language-switcher";
import { toast } from "@/components/ui/toast";
import { signOutAction } from "@/app/[locale]/(auth)/actions";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSidebarCollapsed } from "@/components/chat/use-sidebar-collapsed";
import { cn } from "@/lib/utils";

interface ConversationSummary {
  id: string;
  title: string;
  is_pinned: boolean;
  is_archived: boolean;
  last_message_at: string | null;
  created_at: string;
}

export interface SidebarProps {
  displayName: string;
  email: string;
  planName: string;
  isFreePlan: boolean;
}

export function Sidebar(props: SidebarProps) {
  const t = useTranslations("nav");
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [collapsed, setCollapsed] = useSidebarCollapsed();

  const handleNewChat = React.useCallback(
    (e?: React.MouseEvent) => {
      e?.preventDefault();
      setMobileOpen(false);
      window.dispatchEvent(new CustomEvent("mujeeb:new-chat"));
      router.push("/chat");
    },
    [router],
  );

  return (
    <>
      {/* Mobile header.
          Borderless and on the page's own black, so the app reads as one
          surface on a phone rather than a stack of panels — a hairline
          under a header is a seam you notice on an OLED screen. The
          drawer is a Sheet, so it traps focus and closes on Escape rather
          than being a div that happens to slide. `env(safe-area-inset-top)`
          keeps it clear of the notch when launched from the home screen.
          A new-chat button sits opposite the menu: it is the action people
          reach for most, and burying it in the drawer costs two taps. */}
      <header
        className="flex items-center gap-1 bg-canvas px-1.5 md:hidden"
        style={{ paddingTop: "max(0.375rem, env(safe-area-inset-top))", paddingBottom: "0.375rem" }}
      >
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <Button variant="ghost" size="icon" onClick={() => setMobileOpen(true)} aria-label={t("openMenu")}>
            <Menu className="size-[22px]" />
          </Button>
          <SheetContent side="start" className="w-[86vw] max-w-sm p-0" showClose={false}>
            <SheetTitle className="sr-only">{t("conversations")}</SheetTitle>
            <SidebarContent {...props} onNavigate={() => setMobileOpen(false)} onNewChat={handleNewChat} />
          </SheetContent>
        </Sheet>

        <Link href="/chat" className="flex min-w-0 items-center gap-2" onClick={handleNewChat}>
          <span className="truncate text-[17px] font-semibold tracking-tight">Mujeeb AI</span>
        </Link>

        <div className="flex-1" />

        <Button variant="ghost" size="icon" onClick={handleNewChat} aria-label={t("newChat")}>
          <MessageSquarePlus className="size-[22px]" />
        </Button>
      </header>

      {/* Desktop. Width is animated rather than the element being
          unmounted, so collapsing does not tear down the conversation
          list and refetch it on every toggle. */}
      <aside
        data-collapsed={collapsed || undefined}
        className={cn(
          "hidden shrink-0 border-e border-line bg-surface transition-[width] duration-150 md:flex md:flex-col",
          collapsed ? "w-14" : "w-64",
        )}
      >
        {collapsed ? (
          <CollapsedRail onExpand={() => setCollapsed(false)} onNewChat={handleNewChat} />
        ) : (
          <SidebarContent {...props} onCollapse={() => setCollapsed(true)} onNewChat={handleNewChat} />
        )}
      </aside>
    </>
  );
}

/**
 * The 56px rail shown when the sidebar is collapsed.
 *
 * Deliberately only the actions that make sense without labels — expand,
 * new chat. A conversation
 * list is unusable as a column of identical icons, so it is simply not
 * rendered; expanding is one click away.
 */
function CollapsedRail({
  onExpand,
  onNewChat,
}: {
  onExpand: () => void;
  onNewChat?: (e?: React.MouseEvent) => void;
}) {
  const t = useTranslations("nav");
  const router = useRouter();

  const handleNewChat = React.useCallback(
    (e?: React.MouseEvent) => {
      e?.preventDefault();
      if (onNewChat) {
        onNewChat(e);
      } else {
        window.dispatchEvent(new CustomEvent("mujeeb:new-chat"));
        router.push("/chat");
      }
    },
    [onNewChat, router],
  );

  return (
    <div className="flex h-full flex-col items-center gap-1 py-2.5">
      <RailButton label={t("expandSidebar")} onClick={onExpand}>
        <PanelLeftOpen />
      </RailButton>

      <RailButton label={t("newChat")} onClick={handleNewChat}>
        <MessageSquarePlus />
      </RailButton>

      <div className="flex-1" />

      <RailButton label={t("settings")} onClick={() => router.push("/settings")}>
        <Settings />
      </RailButton>
    </div>
  );
}

function RailButton({
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
        <Button variant="ghost" size="icon" onClick={onClick} aria-label={label}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function BrandMark() {
  return (
    <Image
      src="/logo.png"
      alt="Mujeeb AI"
      width={24}
      height={24}
      priority
      className="size-6 rounded-[7px] object-cover shadow-xs"
    />
  );
}

function SidebarContent({
  displayName,
  email,
  planName,
  isFreePlan,
  onNavigate,
  onCollapse,
  onNewChat,
}: SidebarProps & {
  onNavigate?: () => void;
  onCollapse?: () => void;
  onNewChat?: (e?: React.MouseEvent) => void;
}) {
  const t = useTranslations("nav");
  const tc = useTranslations("chat.conversation");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const pathname = usePathname();

  const [conversations, setConversations] = React.useState<ConversationSummary[] | null>(null);
  const [query, setQuery] = React.useState("");
  const [renaming, setRenaming] = React.useState<ConversationSummary | null>(null);
  const [deleting, setDeleting] = React.useState<ConversationSummary | null>(null);

  const load = React.useCallback(() => {
    fetch("/api/conversations")
      .then((response) => (response.ok ? response.json() : { conversations: [] }))
      .then((data: { conversations: ConversationSummary[] }) => setConversations(data.conversations ?? []))
      .catch(() => setConversations([]));
  }, []);

  // Reload when the route changes, or when custom conversation events fire.
  React.useEffect(() => {
    load();
    const handleRefresh = () => {
      load();
    };
    window.addEventListener("mujeeb:conversations-changed", handleRefresh);
    window.addEventListener("mujeeb:new-chat", handleRefresh);
    return () => {
      window.removeEventListener("mujeeb:conversations-changed", handleRefresh);
      window.removeEventListener("mujeeb:new-chat", handleRefresh);
    };
  }, [load, pathname]);

  const handleNewChat = React.useCallback(
    (e?: React.MouseEvent) => {
      e?.preventDefault();
      onNavigate?.();
      if (onNewChat) {
        onNewChat(e);
      } else {
        window.dispatchEvent(new CustomEvent("mujeeb:new-chat"));
        router.push("/chat");
      }
    },
    [onNewChat, onNavigate, router],
  );

  const visible = React.useMemo(() => {
    const term = query.trim().toLowerCase();
    return (conversations ?? [])
      .filter((conversation) => !conversation.is_archived)
      .filter((conversation) => !term || conversation.title.toLowerCase().includes(term));
  }, [conversations, query]);

  const pinned = visible.filter((conversation) => conversation.is_pinned);
  const recent = visible.filter((conversation) => !conversation.is_pinned);

  async function patch(id: string, body: Record<string, unknown>) {
    const response = await fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      toast.error(tCommon("error"));
      return false;
    }
    return true;
  }

  async function handlePin(conversation: ConversationSummary) {
    const next = !conversation.is_pinned;
    setConversations((previous) =>
      (previous ?? []).map((item) => (item.id === conversation.id ? { ...item, is_pinned: next } : item)),
    );
    if (!(await patch(conversation.id, { isPinned: next }))) load();
  }

  async function handleArchive(conversation: ConversationSummary) {
    setConversations((previous) => (previous ?? []).filter((item) => item.id !== conversation.id));
    if (!(await patch(conversation.id, { isArchived: true }))) load();
    else if (pathname.includes(conversation.id)) {
      window.dispatchEvent(new CustomEvent("mujeeb:new-chat"));
      router.push("/chat");
    }
  }

  async function handleRename(title: string) {
    if (!renaming) return;
    const target = renaming;

    setConversations((previous) =>
      (previous ?? []).map((item) => (item.id === target.id ? { ...item, title } : item)),
    );
    setRenaming(null);

    if (!(await patch(target.id, { title }))) load();
    else router.refresh();
  }

  async function handleDelete() {
    if (!deleting) return;
    const target = deleting;
    setConversations((previous) => (previous ?? []).filter((item) => item.id !== target.id));
    setDeleting(null);

    const response = await fetch(`/api/conversations/${target.id}`, { method: "DELETE" });
    if (!response.ok) {
      toast.error(tCommon("error"));
      load();
      return;
    }
    if (pathname.includes(target.id)) {
      window.dispatchEvent(new CustomEvent("mujeeb:new-chat"));
      router.push("/chat");
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <Link href="/chat" className="flex min-w-0 flex-1 items-center gap-2" onClick={handleNewChat}>
          <BrandMark />
          <span className="truncate text-[13px] font-semibold tracking-tight text-foreground">Mujeeb AI</span>
        </Link>

        {/* Desktop only: on mobile the drawer closes instead. */}
        {onCollapse ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={onCollapse} aria-label={t("collapseSidebar")}>
                <PanelLeftClose />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{t("collapseSidebar")}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 p-2">
        {/* A quiet row, not a filled accent button.
            On a true-black sidebar a solid accent block is the brightest
            thing on screen, and it competes with the conversation the
            person is actually reading. It is still the first item and
            still full width — prominent by position rather than colour. */}
        <Button
          variant="ghost"
          className="w-full justify-start gap-2.5 rounded-lg bg-surface-raised text-[14px] font-medium hover:bg-line"
          onClick={handleNewChat}
        >
          <MessageSquarePlus className="size-[18px]" />
          {t("newChat")}
        </Button>

        <div className="relative">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" aria-hidden />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("search")}
            aria-label={t("search")}
            className="h-8 ps-8 text-[12px]"
          />
        </div>
      </div>

      <nav className="scroll-area min-h-0 flex-1 overflow-y-auto px-2 pb-2" aria-label={t("conversations")}>
        {conversations === null ? (
          <div className="flex flex-col gap-1.5 p-1">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-7 w-full" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <p className="px-2 py-6 text-center text-[12px] text-muted">
            {query ? t("noSearchResults") : t("noConversations")}
          </p>
        ) : (
          <>
            {pinned.length > 0 ? (
              <Section title={t("pinned")}>
                {pinned.map((conversation) => (
                  <ConversationRow
                    key={conversation.id}
                    conversation={conversation}
                    active={pathname.includes(conversation.id)}
                    onNavigate={onNavigate}
                    onPin={() => handlePin(conversation)}
                    onArchive={() => handleArchive(conversation)}
                    onRename={() => setRenaming(conversation)}
                    onDelete={() => setDeleting(conversation)}
                  />
                ))}
              </Section>
            ) : null}

            {recent.length > 0 ? (
              <Section title={pinned.length > 0 ? t("recent") : undefined}>
                {recent.map((conversation) => (
                  <ConversationRow
                    key={conversation.id}
                    conversation={conversation}
                    active={pathname.includes(conversation.id)}
                    onNavigate={onNavigate}
                    onPin={() => handlePin(conversation)}
                    onArchive={() => handleArchive(conversation)}
                    onRename={() => setRenaming(conversation)}
                    onDelete={() => setDeleting(conversation)}
                  />
                ))}
              </Section>
            ) : null}
          </>
        )}
      </nav>

      <div className="border-t border-line p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-1.5 py-1.5 text-start transition-colors hover:bg-surface-raised"
            >
              <Avatar>
                <AvatarFallback>{initialsFor(displayName || email)}</AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-foreground">{displayName || email}</span>
                <span className="block truncate text-[11px] text-faint">{planName}</span>
              </span>
              <MoreHorizontal className="size-3.5 shrink-0 text-faint" aria-hidden />
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="start" side="top" className="w-56">
            <DropdownMenuLabel className="normal-case tracking-normal">{email}</DropdownMenuLabel>
            <DropdownMenuSeparator />

            <DropdownMenuItem asChild>
              <Link href="/settings" onClick={onNavigate}>
                <Settings />
                {t("settings")}
              </Link>
            </DropdownMenuItem>

            {isFreePlan ? (
              <DropdownMenuItem asChild>
                <Link href="/pricing" onClick={onNavigate}>
                  <CreditCard />
                  {t("pricing")}
                </Link>
              </DropdownMenuItem>
            ) : null}

            <DropdownMenuSeparator />

            <div className="flex items-center justify-between gap-2 px-2 py-1.5">
              <span className="text-[12px] text-muted">{tCommon("theme")}</span>
              <ThemeToggle />
            </div>
            <div className="flex items-center justify-between gap-2 px-2 py-1.5">
              <span className="text-[12px] text-muted">{tCommon("language")}</span>
              <LanguageSwitcher />
            </div>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              destructive
              onSelect={() => {
                void signOutAction().then(() => {
                  router.push("/login");
                  router.refresh();
                });
              }}
            >
              <LogOut />
              {t("signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <RenameDialog
        open={renaming !== null}
        onOpenChange={(open) => !open && setRenaming(null)}
        initialTitle={renaming?.title ?? ""}
        onSubmit={handleRename}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={tc("delete")}
        description={tc("deleteConfirm")}
        confirmLabel={tCommon("delete")}
        cancelLabel={tCommon("cancel")}
        onConfirm={handleDelete}
      />
    </div>
  );
}

function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="mb-2 flex flex-col gap-0.5">
      {title ? (
        <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-faint">{title}</p>
      ) : null}
      {children}
    </div>
  );
}

function ConversationRow({
  conversation,
  active,
  onNavigate,
  onPin,
  onArchive,
  onRename,
  onDelete,
}: {
  conversation: ConversationSummary;
  active: boolean;
  onNavigate?: () => void;
  onPin: () => void;
  onArchive: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const tc = useTranslations("chat.conversation");

  return (
    <div
      className={cn(
        "group/row flex items-center gap-0.5 rounded-sm pe-0.5 transition-colors",
        active ? "bg-surface-raised" : "hover:bg-surface-raised",
      )}
    >
      <Link
        href={`/chat/${conversation.id}`}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "min-w-0 flex-1 truncate px-2 py-1.5 text-[13px]",
          active ? "font-medium text-foreground" : "text-muted",
        )}
      >
        {conversation.title || tc("untitled")}
      </Link>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {/* Always reachable by keyboard; only *visually* revealed on
              hover/focus, so the list stays calm without hiding the
              controls from anyone navigating by tab. */}
          <Button
            variant="ghost"
            size="icon-sm"
            className="opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100"
            aria-label={`${tc("actions")} — ${conversation.title}`}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onRename}>
            <Pencil />
            {tc("rename")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onPin}>
            {conversation.is_pinned ? <PinOff /> : <Pin />}
            {conversation.is_pinned ? tc("unpin") : tc("pin")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onArchive}>
            <Archive />
            {tc("archive")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={onDelete}>
            <Trash2 />
            {tc("delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
