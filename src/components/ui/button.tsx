import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * The single button in the design system.
 *
 * Five intents, four sizes — that is the whole vocabulary. There is no
 * "glow" or "glass" variant: emphasis comes from the intent hierarchy
 * (primary > secondary > outline > ghost) rather than from a decorative
 * treatment, so a screen with two competing buttons is visibly a design
 * mistake instead of just two different glows.
 */
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium",
    "rounded-md transition-colors duration-100 select-none",
    "disabled:pointer-events-none disabled:opacity-45",
    "[&_svg]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-foreground hover:bg-accent-hover shadow-xs",
        secondary: "bg-surface-raised text-foreground border border-line hover:border-line-strong",
        outline: "border border-line-strong bg-transparent text-foreground hover:bg-surface-raised",
        ghost: "text-muted hover:bg-surface-raised hover:text-foreground",
        danger: "bg-danger text-white hover:opacity-90 shadow-xs",
        link: "text-accent underline-offset-4 hover:underline h-auto p-0",
      },
      size: {
        sm: "h-8 px-2.5 text-[13px] rounded-sm",
        md: "h-9 px-3.5 text-[13px]",
        lg: "h-11 px-5 text-sm",
        icon: "h-9 w-9 p-0",
        "icon-sm": "h-7 w-7 p-0 rounded-sm [&_svg]:size-3.5",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        // A <button> inside a <form> defaults to type="submit", which is
        // the single most common source of "this button reloads the page"
        // bugs. Default to "button" unless the caller opts in.
        type={asChild ? undefined : (type ?? "button")}
        className={cn(buttonVariants({ variant, size }), className)}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
