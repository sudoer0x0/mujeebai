"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Edge-anchored drawer built on the Dialog primitive, so it inherits the
 * focus trap, focus restore and Escape handling rather than
 * reimplementing them. Used for the mobile conversation drawer (#58).
 *
 * Sides are expressed with logical properties (`start`/`end`) so the
 * drawer opens from the correct edge in Arabic without a second variant.
 */
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

const sideClasses = {
  start: "inset-y-0 start-0 h-full w-[86vw] max-w-[19rem] border-e",
  end: "inset-y-0 end-0 h-full w-[86vw] max-w-[19rem] border-s",
  bottom: "inset-x-0 bottom-0 max-h-[85vh] w-full rounded-t-lg border-t pb-[max(1rem,env(safe-area-inset-bottom))]",
} as const;

export function SheetContent({
  className,
  children,
  side = "start",
  showClose = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  side?: keyof typeof sideClasses;
  showClose?: boolean;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/45" />
      <DialogPrimitive.Content
        className={cn("fixed z-50 flex flex-col border-line bg-surface shadow-md focus:outline-none", sideClasses[side], className)}
        {...props}
      >
        {children}
        {showClose && (
          <DialogPrimitive.Close className="absolute end-3 top-3 rounded-sm p-1 text-faint transition-colors hover:bg-surface-raised hover:text-foreground">
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function SheetTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("text-[15px] font-semibold tracking-tight", className)} {...props} />;
}

export function SheetDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("text-[13px] text-muted", className)} {...props} />;
}
