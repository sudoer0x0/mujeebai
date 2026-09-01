"use client";

import * as React from "react";

const STORAGE_KEY = "mujeeb:sidebar-collapsed";

/**
 * Remembers whether the desktop sidebar is collapsed.
 *
 * Read after mount rather than during the first render: `localStorage` is
 * not available on the server, so seeding state from it directly would
 * make the server and client render different markup and trip React's
 * hydration check. The cost is one frame in the expanded state, which the
 * width transition absorbs.
 *
 * Every access is wrapped — Safari in private mode and "block site data"
 * settings make `localStorage` *throw* rather than return null.
 */
export function useSidebarCollapsed(): [boolean, (next: boolean) => void] {
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // No persistence available; the default is fine.
    }
  }, []);

  const update = React.useCallback((next: boolean) => {
    setCollapsed(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Preference simply won't persist.
    }
  }, []);

  return [collapsed, update];
}
