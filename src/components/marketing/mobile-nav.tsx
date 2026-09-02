"use client";

import * as React from "react";
import Image from "next/image";
import { Menu } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/marketing/theme-toggle";
import { LanguageSwitcher } from "@/components/marketing/language-switcher";

export function MobileNav({ isAuthenticated }: { isAuthenticated: boolean }) {
  const [open, setOpen] = React.useState(false);
  const tNav = useTranslations("nav");
  const tCommon = useTranslations("common");

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-9 rounded-full md:hidden"
          aria-label={tNav("openMenu")}
        >
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>

      <SheetContent side="end" className="flex flex-col justify-between w-[85vw] max-w-xs p-6 bg-surface border-line">
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-2.5">
            <Image
              src="/logo.png"
              alt="Mujeeb AI"
              width={32}
              height={32}
              className="size-8 rounded-[9px] object-cover"
            />
            <SheetTitle className="text-[17px] font-semibold tracking-tight text-foreground">
              Mujeeb AI
            </SheetTitle>
          </div>

          <nav className="flex flex-col gap-2 pt-2">
            <Link
              href="/pricing"
              onClick={() => setOpen(false)}
              className="flex items-center rounded-lg px-3 py-2.5 text-[16px] font-medium text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
            >
              {tNav("pricing")}
            </Link>

            {isAuthenticated ? (
              <div className="pt-2">
                <Button asChild className="h-11 w-full rounded-full bg-foreground text-[15px] font-semibold text-canvas hover:bg-foreground/90">
                  <Link href="/chat" onClick={() => setOpen(false)}>
                    {tNav("openApp")}
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5 pt-2">
                <Button variant="outline" asChild className="h-11 w-full rounded-full border-line text-[15px] font-medium">
                  <Link href="/login" onClick={() => setOpen(false)}>
                    {tNav("signIn")}
                  </Link>
                </Button>
                <Button asChild className="h-11 w-full rounded-full bg-foreground text-[15px] font-semibold text-canvas hover:bg-foreground/90">
                  <Link href="/register" onClick={() => setOpen(false)}>
                    {tNav("signUp")}
                  </Link>
                </Button>
              </div>
            )}
          </nav>
        </div>

        <div className="border-t border-line pt-4">
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-muted">{tCommon("language")} / {tCommon("theme")}</span>
            <div className="flex items-center gap-2">
              <LanguageSwitcher />
              <ThemeToggle />
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
