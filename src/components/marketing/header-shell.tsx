"use client";

import * as React from "react";

/**
 * Gives the header a surface once the page has scrolled.
 *
 * At the top the header shares the hero's background and shows no edge —
 * a rule under a header sitting on the same colour as the content below it
 * only fences the page. Once anything has scrolled beneath it, it needs to
 * separate itself from what it is covering, so it picks up a translucent
 * background, a blur and a hairline.
 *
 * The listener is passive and only ever compares against a single
 * threshold, so it does no layout reads and cannot block scrolling.
 */
export function HeaderShell({ children }: { children: React.ReactNode }) {
  const [scrolled, setScrolled] = React.useState(false);

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);

    // Run once: a reload part-way down the page should not start bare.
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header data-scrolled={scrolled ? "true" : "false"} className="site-header sticky top-0 z-40 w-full">
      {children}
    </header>
  );
}
