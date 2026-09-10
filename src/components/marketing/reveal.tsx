"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Reveals its children once, when they first scroll into view.
 *
 * ## Why an observer rather than a scroll listener
 *
 * A scroll handler runs on every frame of every scroll for the life of the
 * page, to answer a question that becomes permanently false after the
 * first yes. `IntersectionObserver` is answered by the browser off the
 * main thread and is disconnected the moment the element has appeared, so
 * a long page costs nothing after its content has been seen.
 *
 * ## Why it starts visible
 *
 * The initial state is "revealed", and the observer *hides* it on mount
 * before revealing. That ordering matters: the server-rendered HTML is
 * complete and readable, so anyone with JavaScript off, or on a slow
 * connection before hydration, gets the whole page rather than a blank
 * one. The animation is an enhancement, never a precondition for content.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  /** Stagger, in milliseconds, for items revealed as a group. */
  delay?: number;
  as?: "div" | "section" | "li";
}) {
  const ref = React.useRef<HTMLElement | null>(null);
  const [shown, setShown] = React.useState(true);

  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    // Honour the system preference before doing anything else — no hide,
    // no observer, no transition.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // Already on screen at first paint (the hero, typically): leave it
    // alone so the page does not flash its own content out and back in.
    const rect = element.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.9) return;

    setShown(false);

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          setShown(true);
          observer.disconnect();
        }
      },
      // A little before the edge, so content settles smoothly as the
      // reader scrolls towards it without popping in late or feeling laggy.
      { rootMargin: "0px 0px 40px 0px", threshold: 0.02 },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as React.Ref<never>}
      data-shown={shown ? "true" : "false"}
      style={delay ? ({ "--reveal-delay": `${delay}ms` } as React.CSSProperties) : undefined}
      className={cn("reveal", className)}
    >
      {children}
    </Tag>
  );
}
