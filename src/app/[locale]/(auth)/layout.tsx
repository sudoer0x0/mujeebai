import { Link } from "@/i18n/navigation";
import { AuthLanguageSwitcher } from "@/components/auth/auth-language-switcher";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="flex items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <span
            aria-hidden
            className="flex size-6 items-center justify-center rounded-md bg-foreground text-[11px] font-bold text-canvas"
          >
            M
          </span>
          <span className="text-[14px] font-semibold tracking-tight text-foreground">Mujeeb AI</span>
        </Link>
        <AuthLanguageSwitcher />
      </header>

      <main
        id="main"
        className="flex flex-1 items-center justify-center px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-4"
      >
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
