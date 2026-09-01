import { getTranslations } from "next-intl/server";
import { SiteHeader } from "@/components/marketing/site-header";
import { Link } from "@/i18n/navigation";

export default async function MarketingLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "common" });
  const tn = await getTranslations({ locale, namespace: "nav" });
  const tf = await getTranslations({ locale, namespace: "landing.footer" });

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="skip-link">
        {t("skipToContent")}
      </a>
      <SiteHeader />
      <main id="main" className="flex-1">
        {children}
      </main>

      {/* A footer with the same container as the page above it. The old
          one used a narrower max width, so its content visibly stepped in
          from everything else on the page. */}
      <footer className="border-t border-line">
        <div className="mx-auto w-full max-w-[76rem] px-5 py-10 sm:px-8 sm:py-12">
          <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-xs">
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden
                  className="flex size-7 items-center justify-center rounded-[9px] bg-gradient-to-br from-accent to-accent-hover text-[12px] font-bold text-accent-text"
                >
                  M
                </span>
                <span className="text-[15px] font-semibold tracking-tight text-foreground">Mujeeb AI</span>
              </div>
              <p className="mt-3 text-[13px] leading-relaxed text-muted">{tf("tagline")}</p>
            </div>

            <nav className="flex flex-col gap-2.5 text-[13px]" aria-label={tf("product")}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">{tf("product")}</p>
              <FooterLink href="/pricing">{tn("pricing")}</FooterLink>
              <FooterLink href="/login">{tn("signIn")}</FooterLink>
              <FooterLink href="/register">{tn("signUp")}</FooterLink>
            </nav>
          </div>

          <div className="mt-10 border-t border-line pt-6 text-[12px] text-faint">
            <p>
              © {new Date().getFullYear()} Mujeeb AI. {tf("rights")}
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="w-fit text-muted transition-colors hover:text-foreground">
      {children}
    </Link>
  );
}
