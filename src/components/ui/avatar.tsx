"use client";

import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { cn } from "@/lib/utils";

export function Avatar({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Root>) {
  return (
    <AvatarPrimitive.Root
      className={cn("relative flex size-7 shrink-0 overflow-hidden rounded-full bg-surface-raised", className)}
      {...props}
    />
  );
}

export function AvatarImage({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return <AvatarPrimitive.Image className={cn("aspect-square size-full object-cover", className)} {...props} />;
}

export function AvatarFallback({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      className={cn("flex size-full items-center justify-center text-[11px] font-semibold text-muted", className)}
      {...props}
    />
  );
}

/** Deterministic initials for a display name or email. */
export function initialsFor(nameOrEmail: string): string {
  const source = nameOrEmail.trim();
  if (!source) return "?";
  const local = source.includes("@") ? source.split("@")[0] : source;
  const words = local.split(/[\s._-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return local.slice(0, 2).toUpperCase();
}
