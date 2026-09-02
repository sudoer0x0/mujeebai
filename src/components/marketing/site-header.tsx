import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/marketing/theme-toggle";
import { LanguageSwitcher } from "@/components/marketing/language-switcher";
import { HeaderShell } from "@/components/marketing/header-shell";
import { MobileNav } from "@/components/marketing/mobile-nav";
import { getCurrentUser } from "@/auth/session";

import Image from "next/image";

export async function SiteHeader() {
  const t = await getTranslations("nav");
  const user = await getCurrentUser();

  return (
    <HeaderShell>
      <div className="mx-auto flex h-[62px] sm:h-[68px] max-w-[76rem] items-center justify-between gap-2 px-4 sm:px-8">
        <Link href="/" className="group flex items-center gap-2.5 shrink-0">
          <Image
            src="/logo.png"
            alt="Mujeeb AI"
            width={34}
            height={34}
            priority
            className="size-8 sm:size-9 rounded-[10px] sm:rounded-[11px] object-cover shadow-sm transition-transform duration-200 group-hover:scale-105"
          />
          <span className="text-[17px] sm:text-[18px] font-semibold tracking-tight text-foreground">Mujeeb AI</span>
        </Link>

        {/* Nav links for desktop */}
        <nav className="ms-4 hidden items-center gap-1 md:flex">
          <HeaderLink href="/pricing">{t("pricing")}</HeaderLink>
        </nav>

        {/* Desktop actions: language, theme, sign in, sign up */}
        <div className="ms-auto hidden items-center gap-1 md:flex">
          <LanguageSwitcher />
          <ThemeToggle />

          <span aria-hidden className="mx-1.5 h-5 w-px bg-line" />

          {user ? (
            <Button size="sm" asChild className="h-9 rounded-full bg-foreground px-4 text-[14px] font-semibold text-canvas hover:bg-foreground/90">
              <Link href="/chat">{t("openApp")}</Link>
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/login">{t("signIn")}</Link>
              </Button>
              <Button size="sm" asChild className="h-9 rounded-full bg-foreground px-4 text-[14px] font-semibold text-canvas hover:bg-foreground/90">
                <Link href="/register">{t("signUp")}</Link>
              </Button>
            </>
          )}
        </div>

        {/* Mobile controls: clean, spacious CTA + hamburger drawer */}
        <div className="flex items-center gap-1.5 md:hidden">
          {user ? (
            <Button size="sm" asChild className="h-8 rounded-full bg-foreground px-3.5 text-[13px] font-semibold text-canvas hover:bg-foreground/90">
              <Link href="/chat">{t("openApp")}</Link>
            </Button>
          ) : (
            <Button size="sm" asChild className="h-8 rounded-full bg-foreground px-3.5 text-[13px] font-semibold text-canvas hover:bg-foreground/90">
              <Link href="/register">{t("signUp")}</Link>
            </Button>
          )}
          <MobileNav isAuthenticated={Boolean(user)} />
        </div>
      </div>
    </HeaderShell>
  );
}

function HeaderLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md px-3 py-2 text-[15px] text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
    >
      {children}
    </Link>
  );
}
