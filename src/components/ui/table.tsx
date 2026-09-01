import { cn } from "@/lib/utils";

/**
 * Data table primitives.
 *
 * Every admin/moderator list used to hand-roll its own `<table>` with
 * slightly different padding, header casing and border treatment. These
 * are the one implementation.
 *
 * `TableScroll` is mandatory around a table: on narrow viewports the
 * table scrolls inside its own container rather than forcing the whole
 * page to scroll sideways, and it is focusable so keyboard users can
 * actually reach the scroll region.
 */
export function TableScroll({
  className,
  maxHeight,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  /**
   * Caps the table's height so it scrolls inside itself, with the header
   * pinned. Without this a 200-row log makes the whole page scroll, the
   * column headings disappear after the first screen, and every scroll has
   * to start from the top of the document — which is what makes a long
   * table feel stiff.
   */
  maxHeight?: string;
}) {
  return (
    <div
      tabIndex={0}
      role="region"
      style={maxHeight ? { maxHeight } : undefined}
      className={cn(
        "scroll-area overflow-x-auto rounded-lg border border-line",
        // `overscroll-contain` stops a flick at the end of the table from
        // scrolling the page behind it.
        maxHeight && "overflow-y-auto overscroll-contain",
        className,
      )}
      {...props}
    />
  );
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full min-w-max border-collapse text-[13px]", className)} {...props} />;
}

export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        // Pinned to the top of the scroll container, so the columns stay
        // labelled however far down a long table you are. Harmless when
        // the container does not scroll vertically.
        "sticky top-0 z-10 bg-surface-raised",
        className,
      )}
      {...props}
    />
  );
}

export function TBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("divide-y divide-line", className)} {...props} />;
}

export function TR({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("transition-colors hover:bg-surface-raised/60", className)} {...props} />;
}

export function TH({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        "whitespace-nowrap border-b border-line px-3 py-2 text-start text-[11px] font-semibold uppercase tracking-wide text-faint",
        className,
      )}
      {...props}
    />
  );
}

export function TD({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-3 py-2.5 align-middle text-foreground", className)} {...props} />;
}

export function TableEmpty({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-10 text-center text-[13px] text-muted">
        {children}
      </td>
    </tr>
  );
}
