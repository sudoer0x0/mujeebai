"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PasswordInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  wrapperClassName?: string;
  /** Localized label for the reveal toggle. */
  showLabel?: string;
  hideLabel?: string;
  invalid?: boolean;
}

/**
 * Password field with a reveal toggle.
 *
 * The toggle is a real, focusable button (it used to carry
 * `tabIndex={-1}`, which put it out of reach for anyone navigating by
 * keyboard) and announces its state through `aria-pressed`, so a screen
 * reader user knows whether the password is currently visible.
 */
export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, wrapperClassName, showLabel = "Show password", hideLabel = "Hide password", invalid, ...props }, ref) => {
    const [visible, setVisible] = React.useState(false);

    return (
      <div className={cn("relative flex w-full items-center", wrapperClassName)}>
        <input
          {...props}
          ref={ref}
          type={visible ? "text" : "password"}
          aria-invalid={invalid || undefined}
          className={cn(
            "h-9 w-full rounded-md border border-line bg-surface ps-2.5 pe-10 text-[13px] text-foreground",
            "placeholder:text-faint transition-colors hover:border-line-strong",
            "disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:opacity-60",
            "aria-[invalid=true]:border-danger",
            className,
          )}
        />
        <button
          type="button"
          onClick={() => setVisible((prev) => !prev)}
          aria-pressed={visible}
          aria-label={visible ? hideLabel : showLabel}
          className="absolute end-1 flex size-7 items-center justify-center rounded-sm text-faint transition-colors hover:bg-surface-raised hover:text-foreground"
        >
          {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        </button>
      </div>
    );
  },
);

PasswordInput.displayName = "PasswordInput";
