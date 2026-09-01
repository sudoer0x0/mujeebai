"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  Activity,
  CreditCard,
  Cpu,
  Flag,
  Gauge,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  ScrollText,
  Server,
  Settings2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Users,
  Wallet,
  UserCog,
  KeyRound,
  Megaphone,
  LogOut,
  Mail,
} from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { signOutAction } from "@/app/[locale]/(auth)/actions";
import { StaffIdleGuard } from "@/components/staff/idle-guard";
import { cn } from "@/lib/utils";

/**
 * Icons are referenced by name, not passed as components.
 *
 * The layouts that describe these sections are Server Components, and a
 * React component is a function — handing one to a Client Component prop
 * fails at render with "Functions cannot be passed directly to Client
 * Components". Naming the icon keeps the nav description serializable.
 */
const ICONS = {
  dashboard: LayoutDashboard,
  status: Activity,
  users: Users,
  moderation: ShieldAlert,
  usage: Gauge,
  plans: CreditCard,
  subscriptions: Wallet,
  models: Cpu,
  providers: Server,
  systemPrompt: MessageSquareText,
  featureFlags: Flag,
  settings: Settings2,
  auditLogs: ScrollText,
  moderators: UserCog,
  security: KeyRound,
  announcements: Megaphone,
  emailTemplates: Mail,
} as const;

export type StaffNavIcon = keyof typeof ICONS;

export interface StaffNavItem {
  href: string;
  labelKey: string;
  icon: StaffNavIcon;
}

export interface StaffNavSection {
  titleKey?: string;
  items: StaffNavItem[];
}

/**
 * Shared chrome for the two staff portals.
 *
 * `/admin` and `/moderator` are separate route trees with separate
 * server-side guards, but they should not be two separately-maintained
 * layouts — this renders both from a nav description, so a moderator's
 * console is visibly the same product without ever being handed an
 * admin-only link.
 *
 * The visual language is deliberately denser and flatter than the chat
 * app (#128): tighter rows, tabular numbers, no decorative surfaces. An
 * operator scanning a hundred accounts wants information density; a
 * person having a conversation does not.
 */
export function StaffShell({
  sections,
  namespace,
  rootHref,
  roleLabel,
  portalTitle,
  variant,
  locale,
  children,
}: {
  sections: StaffNavSection[];
  /** Message namespace the nav labels resolve against. */
  namespace: "admin" | "moderator";
  /**
   * The portal's own root, already carrying the secret prefix when one is
   * configured. Passed in rather than derived from `namespace`, because
   * with a prefix the root is `/{slug}/admin`, not `/admin`.
   */
  rootHref: string;
  roleLabel: string;
  portalTitle: string;
  variant: "admin" | "moderator";
  locale: string;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    // `h-dvh` + `overflow-hidden` from md up, so the sidebar and the
    // content pane each own their scrolling. It used to be `min-h-screen`,
    // which meant the shell grew with the page: the nav's `overflow-y-auto`
    // never had a bounded height to scroll inside, so the whole document
    // scrolled and the sidebar slid away with it. On small screens the
    // page scrolls normally — a phone has no room for two scroll areas.
    <div className="flex min-h-dvh flex-col bg-canvas md:h-dvh md:flex-row md:overflow-hidden">
      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-surface px-3 py-2 md:hidden">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={portalTitle}>
              <Menu />
            </Button>
          </SheetTrigger>
          <SheetContent side="start" className="p-0">
            <SheetTitle className="sr-only">{portalTitle}</SheetTitle>
            <PortalIdentity variant={variant} portalTitle={portalTitle} roleLabel={roleLabel} />
            <div className="scroll-area min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
              <StaffNav sections={sections} namespace={namespace} rootHref={rootHref} onNavigate={() => setMobileOpen(false)} />
            </div>
            <ExitPortal locale={locale} />
          </SheetContent>
        </Sheet>
        <span className="text-[13px] font-semibold text-foreground">{portalTitle}</span>
        <Badge variant={variant === "admin" ? "accent" : "warning"} className="ms-auto">
          {roleLabel}
        </Badge>
      </div>

      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-e border-line bg-surface md:flex md:h-dvh">
        <PortalIdentity variant={variant} portalTitle={portalTitle} roleLabel={roleLabel} />
        {/* `overscroll-contain` stops a flick at the end of the nav from
            chaining into the content pane behind it. */}
        <nav className="scroll-area min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
          <StaffNav sections={sections} namespace={namespace} rootHref={rootHref} />
        </nav>
        <ExitPortal locale={locale} />
      </aside>

      {/* Ends an unattended console session. The server enforces the same
          cut-off independently — this is what keeps an operator who is
          reading rather than clicking from being caught by it. */}
      <StaffIdleGuard locale={locale} />

      <main id="main" className="scroll-area min-w-0 flex-1 md:overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">{children}</div>
      </main>
    </div>
  );
}

function PortalIdentity({
  variant,
  portalTitle,
  roleLabel,
}: {
  variant: "admin" | "moderator";
  portalTitle: string;
  roleLabel: string;
}) {
  const Icon = variant === "admin" ? ShieldCheck : Shield;
  return (
    <div className="flex items-center gap-2.5 border-b border-line px-3.5 py-3">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-raised">
        <Icon className="size-3.5 text-muted" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold tracking-tight text-foreground">{portalTitle}</p>
        <p className="truncate text-[11px] text-faint">{roleLabel}</p>
      </div>
    </div>
  );
}

/**
 * Leaving the console.
 *
 * This used to be a link to `/chat`, which was the single place the two
 * worlds touched: one click took an authenticated administrator straight
 * into the customer product, still holding an administrative session. The
 * portals are meant to be separate all the way down, so the exit now ends
 * the session and returns to the public homepage — there is no path from
 * here into the app as a user.
 *
 * Behind a confirmation because it is destructive to a working session:
 * an operator who mis-clicks a sidebar row should not lose an
 * authenticator step-up and have to enrol a code again mid-task.
 */
function ExitPortal({ locale }: { locale: string }) {
  const t = useTranslations("staffAuth.exit");
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  async function confirm() {
    setPending(true);
    try {
      await signOutAction();
    } finally {
      // A hard navigation, not a client-side route change: the session
      // cookie has just been cleared server-side and every cached RSC
      // payload for the console is now stale. `window.location` throws
      // that cache away instead of rendering a console the viewer is no
      // longer entitled to.
      window.location.href = `/${locale}`;
    }
  }

  return (
    <div className="border-t border-line p-2">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-start text-[13px] text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
      >
        <LogOut className="size-3.5 rtl:rotate-180" aria-hidden />
        {t("action")}
      </button>

      <ConfirmDialog
        open={open}
        onOpenChange={(next) => (pending ? undefined : setOpen(next))}
        title={t("title")}
        description={t("description")}
        consequences={[t("consequenceSignOut"), t("consequenceReauth")]}
        confirmLabel={t("confirm")}
        cancelLabel={t("cancel")}
        tone="danger"
        onConfirm={confirm}
      />
    </div>
  );
}

function StaffNav({
  sections,
  namespace,
  rootHref,
  onNavigate,
}: {
  sections: StaffNavSection[];
  namespace: "admin" | "moderator";
  rootHref: string;
  onNavigate?: () => void;
}) {
  const t = useTranslations(namespace);
  const pathname = usePathname();

  return (
    <div className="flex flex-col gap-4">
      {sections.map((section, index) => (
        <div key={section.titleKey ?? index} className="flex flex-col gap-0.5">
          {section.titleKey ? (
            <p className="px-2.5 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-faint">
              {t(section.titleKey as never)}
            </p>
          ) : null}
          {section.items.map((item) => {
            // Exact match for the portal root, prefix match elsewhere, so
            // /admin does not stay highlighted on /admin/users.
            const isRoot = item.href === rootHref;
            const active = isRoot ? pathname === item.href : pathname.startsWith(item.href);

            const Icon = ICONS[item.icon];

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-[13px] transition-colors",
                  active
                    ? "bg-surface-raised font-medium text-foreground"
                    : "text-muted hover:bg-surface-raised hover:text-foreground",
                )}
              >
                <Icon className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{t(item.labelKey as never)}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </div>
  );
}
