import * as React from "react";
import { cn } from "@/lib/utils";

const fieldBase =
  "w-full rounded-md border bg-surface text-foreground placeholder:text-faint transition-colors " +
  "disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:opacity-60 " +
  "aria-[invalid=true]:border-danger";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Renders the danger border and wires aria-invalid for assistive tech. */
  invalid?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, ...props }, ref) => (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(fieldBase, "h-9 border-line px-2.5 text-[13px] hover:border-line-strong", className)}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid, ...props }, ref) => (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(fieldBase, "min-h-20 resize-y border-line px-2.5 py-2 text-[13px] leading-relaxed", className)}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";

/**
 * Label + control + description/error, laid out consistently.
 *
 * Wiring `htmlFor`, `aria-describedby` and `aria-invalid` by hand at every
 * call site is how forms end up half-accessible; this does it once. The
 * error message is rendered in a live region so a screen reader announces
 * a validation failure the moment it appears.
 */
export function Field({
  id,
  label,
  description,
  error,
  required,
  children,
  className,
}: {
  id: string;
  label: string;
  description?: string;
  error?: string | null;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-[12px] font-medium text-foreground">
        {label}
        {required ? (
          <span className="ms-0.5 text-danger" aria-hidden>
            *
          </span>
        ) : null}
      </label>

      {React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
            id,
            "aria-describedby": [descriptionId, errorId].filter(Boolean).join(" ") || undefined,
            "aria-invalid": error ? true : undefined,
            required,
          })
        : children}

      {description && !error ? (
        <p id={descriptionId} className="text-[12px] text-muted">
          {description}
        </p>
      ) : null}

      <p id={errorId} role="alert" className={cn("text-[12px] text-danger", !error && "sr-only")}>
        {error ?? ""}
      </p>
    </div>
  );
}
