"use client";

import { Toaster } from "sonner";

export { toast } from "sonner";

/**
 * Thin wrapper so the rest of the app depends on `@/components/ui/toast`
 * rather than on `sonner` directly (dependency philosophy, #111).
 *
 * Positioned bottom-centre on mobile so a toast never lands under the
 * composer's send button, and top-right on desktop where it stays clear
 * of the chat column.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Toaster
        position="bottom-center"
        offset={16}
        mobileOffset={16}
        gap={8}
        toastOptions={{
          className: "!rounded-md !border !text-[13px]",
          style: {
            background: "var(--surface)",
            color: "var(--text-primary)",
            borderColor: "var(--line-strong)",
            boxShadow: "var(--shadow-md)",
          },
        }}
      />
    </>
  );
}
