/**
 * Normalizes a caller-supplied `next` destination to a safe same-origin
 * path.
 *
 * Anything that could leave the origin is rejected outright rather than
 * patched up: absolute URLs, protocol-relative `//host` (which a browser
 * resolves as a *different* origin), the backslash variants some parsers
 * treat as slashes, and the control characters used to smuggle a scheme
 * past a naive prefix check. Callers should always build the final URL
 * from this result plus a trusted origin — never with caller input as the
 * base.
 */
export function safeNextPath(value: string | null | undefined, fallback = "/"): string {
  if (!value) return fallback;

  // Drop every character at or below U+0020 (control characters,
  // newlines, tabs, spaces) before inspecting the prefix. Without this, a
  // tab- or newline-prefixed "//evil.com" slips past the checks below and
  // browsers still resolve it as a cross-origin destination.
  const candidate = Array.from(value)
    .filter((char) => char.codePointAt(0)! > 0x20)
    .join("");

  if (!candidate.startsWith("/")) return fallback;
  if (candidate.startsWith("//")) return fallback;
  // `/\evil.com` is treated as protocol-relative by some URL parsers.
  if (candidate.startsWith("/\\")) return fallback;
  if (candidate.includes("://")) return fallback;

  return candidate;
}
