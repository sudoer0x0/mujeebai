import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/marketing/theme-toggle";
import { LanguageSwitcher } from "@/components/marketing/language-switcher";
import { HeaderShell } from "@/components/marketing/header-shell";
import { getCurrentUser } from "@/auth/session";

export async function SiteHeader() {
  const t = await getTranslations("nav");
  const user = await getCurrentUser();

  return (
    <HeaderShell>
      <div className="mx-auto flex h-[68px] max-w-[76rem] items-center gap-3 px-5 sm:px-8">
        <Link href="/" className="group flex items-center gap-2.5">
          {/* The mark carries the accent, which is the one colour the
              product uses to mean "this is us". A flat foreground square
              read as a placeholder. */}
          <span
            aria-hidden
            className="flex size-9 items-center justify-center rounded-[11px] bg-gradient-to-br from-accent to-accent-hover text-[15px] font-bold text-accent-text shadow-sm transition-transform duration-200 group-hover:scale-105"
          >
            M
          </span>
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
