"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useTranslations } from "next-intl";

/**
 * A fenced code block.
 *
 * ## Why the syntax theme is always the dark one
 *
 * The block's chrome is a dark terminal in both app themes — the window
 * bar, the traffic lights and the `#0d0f14` surface are not theme-aware.
 * The syntax theme has to match the surface it sits on, and it was instead
 * chosen from `window.matchMedia` *during render*: `undefined` on the
 * server, so the light Prism theme was picked and shipped inside a dark
 * block. Every token carried a near-white background, which is what made
 * the code close to unreadable.
 *
 * Pinning it to the dark theme also removes a hydration hazard: a value
 * read from `matchMedia` at render time cannot agree between server and
 * client by construction.
 */
export function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const t = useTranslations("chat");

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <div className="my-4 overflow-hidden rounded-2xl border border-line/80 bg-[#0d0f14] shadow-xl text-left font-mono">
      {/* Terminal Window Bar */}
      <div className="flex items-center justify-between border-b border-line/50 bg-[#12151d] px-3.5 py-2 text-xs text-muted">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
            <div className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
            <div className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
          </div>
          <span className="ml-2 font-mono text-[11px] font-medium text-muted tracking-tight">
            {language || "text"}
          </span>
        </div>

        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1.5 rounded-lg border border-line/40 bg-surface/40 px-2 py-1 text-[11px] font-medium text-muted hover:text-foreground hover:bg-surface transition-colors cursor-pointer"
        >
          {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
          <span>{copied ? t("copied") : t("copy")}</span>
        </button>
      </div>

      <div className="overflow-x-auto text-[13px] leading-relaxed">
        <SyntaxHighlighter
          language={language || "text"}
          style={oneDark}
          customStyle={{
            margin: 0,
            padding: "1rem 1.25rem",
            background: "transparent",
            fontSize: "0.8125rem",
            lineHeight: "1.6",
          }}
          // `customStyle` only reaches the <pre>. The Prism themes set a
          // background on `code[class*="language-"]` as well, and without
          // clearing it the inner element paints its own panel behind every
          // line — the boxes-around-each-line effect. Both have to be
          // transparent for the block's own surface to show through.
          codeTagProps={{
            style: { background: "transparent", fontFamily: "inherit", textShadow: "none" },
          }}
          wrapLongLines={false}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}
