// Runs before hydration to avoid a light/dark flash on load. Served as a
// static file (rather than inlined into the HTML) specifically so the page
// can ship a Content-Security-Policy without `script-src 'unsafe-inline'` —
// see next.config.ts and SECURITY.md. Keep this file static (no per-request
// templating) so it can be cached like any other static asset.
(function () {
  try {
    var stored = window.localStorage.getItem("mujeeb-theme");
    if (stored === "light" || stored === "dark") {
      document.documentElement.setAttribute("data-theme", stored);
    }
  } catch {}

  // Reading font is applied here for the same reason the theme is: before
  // first paint, so the page never renders in one face and then swaps.
  //
  // It is deliberately NOT read from the database in the locale layout.
  // That layout exports `generateStaticParams`, which Next evaluates in a
  // separate worker process — pulling Supabase into that module graph made
  // the worker fail with "Cannot find module './vendor-chunks/@supabase.js'"
  // on every page load. Reading it here also keeps the marketing pages
  // statically renderable, which a `cookies()` call in the root layout
  // would have ended.
  //
  // The allowlist below is what makes a cookie safe to act on: the value
  // only ever selects a CSS rule, and an unrecognised one is ignored
  // rather than written through. The database CHECK constraint and the zod
  // enum still govern what can be *stored*.
  try {
    var FONTS = [
      "system", "grotesk", "humanist", "geometric",
      "rounded", "serif", "slab", "mono", "reading",
    ];
    var match = document.cookie.match(/(?:^|;\s*)MUJEEB_FONT=([^;]*)/);
    if (match) {
      var font = decodeURIComponent(match[1]);
      if (FONTS.indexOf(font) !== -1) {
        document.documentElement.setAttribute("data-font", font);
      }
    }
  } catch {}

  // Accent, applied before first paint for the same reason the theme is:
  // otherwise the page renders in the default blue and then swaps.
  //
  // The allowlist is what makes acting on a cookie safe here — the value
  // only ever selects a CSS rule, and an unrecognised one is ignored. The
  // database CHECK constraint and the zod enum govern what can be stored.
  try {
    var ACCENTS = ["default", "violet", "emerald", "amber", "rose", "cyan", "slate"];
    var am = document.cookie.match(/(?:^|;\s*)MUJEEB_ACCENT=([^;]*)/);
    if (am) {
      var accent = decodeURIComponent(am[1]);
      if (ACCENTS.indexOf(accent) !== -1 && accent !== "default") {
        document.documentElement.setAttribute("data-accent", accent);
      }
    }
  } catch {}
})();
