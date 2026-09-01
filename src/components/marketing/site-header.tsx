import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/marketing/theme-toggle";
import { LanguageSwitcher } from "@/components/marketing/language-switcher";
import { HeaderShell } from "@/components/marketing/header-shell";
import { getCurrentUser } from "@/auth/session";

import Image from "next/image";

export async function SiteHeader() {
  const t = await getTranslations("nav");
  const user = await getCurrentUser();

  return (
    <HeaderShell>
      <div className="mx-auto flex h-[68px] max-w-[76rem] items-center gap-3 px-5 sm:px-8">
        <Link href="/" className="group flex items-center gap-2.5">
          <Image
            src="/logo.png"
            alt="Mujeeb AI"
            width={36}
            height={36}
            priority
            className="size-9 rounded-[11px] object-cover shadow-sm transition-transform duration-200 group-hover:scale-105"
          />
          <span className="text-[18px] font-semibold tracking-tight text-foreground">Mujeeb AI</span>
        </Link>

        {/* Nav links, not buttons. A row of button chrome across the top
            competes with the one action that matters. */}
        <nav className="ms-4 hidden items-center gap-1 md:flex">
          <HeaderLink href="/pricing">{t("pricing")}</HeaderLink>
        </nav>

        <div className="ms-auto flex items-center gap-1">
          <LanguageSwitcher />
          <ThemeToggle />

          <span aria-hidden className="mx-1.5 hidden h-5 w-px bg-line sm:block" />

          {user ? (
            <Button size="sm" asChild>
              <Link href="/chat">{t("openApp")}</Link>
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
                <Link href="/login">{t("signIn")}</Link>
              </Button>
              <Button size="sm" asChild>
                <Link href="/register">{t("signUp")}</Link>
              </Button>
            </>
          )}
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
