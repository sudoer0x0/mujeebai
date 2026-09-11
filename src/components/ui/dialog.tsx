"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

/**
 * Modal dialog.
 *
 * Radix handles focus trapping, restore-on-close, Escape and the
 * `aria-modal` semantics. Every dialog must render a `DialogTitle` — it
 * is what a screen reader announces on open, and Radix warns loudly if it
 * is missing.
 *
 * On small screens the panel drops to the bottom of the viewport, which
 * keeps the primary action inside thumb reach instead of centring a
 * modal the on-screen keyboard would cover.
 */
export function DialogContent({
  className,
  children,
  showClose = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { showClose?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-black/45" />
      <DialogPrimitive.Content
        className={cn(
          "fixed z-[70] flex flex-col gap-4 border border-line bg-surface p-5 shadow-md focus:outline-none",
          "inset-x-0 bottom-0 rounded-t-lg pb-[max(1.25rem,env(safe-area-inset-bottom))]",
          "sm:inset-x-auto sm:bottom-auto sm:start-1/2 sm:top-1/2 sm:w-full sm:max-w-md",
          "sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:pb-5 rtl:sm:translate-x-1/2",
          className,
        )}
        {...props}
      >
        {children}
        {showClose && (
          <DialogPrimitive.Close
            className="absolute end-3.5 top-3.5 rounded-sm p-1 text-faint transition-colors hover:bg-surface-raised hover:text-foreground"
          >
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 pe-8", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("text-[15px] font-semibold tracking-tight", className)} {...props} />;
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("text-[13px] leading-relaxed text-muted", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />;
}
