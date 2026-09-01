"use client";

import * as React from "react";

/**
 * Registers the service worker.
 *
 * Deliberately after `load`: registration competes with the first render
 * for the main thread, and a worker that installs a second later costs
 * nothing while a slower first paint costs every visitor.
 *
 * Registration is skipped in development. A worker that caches a dev
 * build is the classic "why am I still seeing the old page" bug, and it
 * outlives the dev server it came from.
 */
export function ServiceWorkerRegistration() {
  React.useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // A failed registration is not worth telling anyone about: the
        // app works identically without it, minus offline support.
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
