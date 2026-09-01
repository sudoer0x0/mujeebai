import { cn } from "@/lib/utils";

/**
 * Indeterminate loading indicator.
 *
 * Renders an accessible label by default so a button that swaps its text
 * for a spinner still announces "Loading" rather than going silent.
 */
export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return (
    <span role="status" className="inline-flex items-center">
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className={cn("spin size-4 shrink-0", className)}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="8" cy="8" r="6.5" opacity="0.25" />
        <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" strokeLinecap="round" />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  );
}
