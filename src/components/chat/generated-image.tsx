"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Download, Copy, Check, Expand, X } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/**
 * An image inside a reply — in practice, a generated one.
 *
 * ## Why it is not just an `<img>` in a link
 *
 * It used to be, which meant the only thing you could do with a generated
 * image was open it in a new browser tab. There was no way to download it,
 * no way to copy it, and viewing it meant leaving the conversation. For a
 * feature whose entire output *is* the image, that is the whole product
 * surface missing.
 *
 * Now: click to view it full size without leaving the page, and copy or
 * download it from either the card or the viewer.
 */
export function GeneratedImage({ src, alt }: { src: string; alt: string }) {
  const t = useTranslations("chat.image");
  const [open, setOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  // Escape closes the viewer, and the page behind it must not scroll while
  // it is open — both are what separate a real overlay from a div on top.
  React.useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const previousOverflow = document.body.style.overflow;

    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  async function download() {
    setBusy(true);
    try {
      // Fetched rather than linked with `download`: the src is an
      // auth-gated redirect to a signed URL on another origin, and a
      // cross-origin `download` attribute is ignored by browsers — the
      // file would open in a tab instead of saving.
      const response = await fetch(src);
      if (!response.ok) throw new Error(String(response.status));

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filenameFor(alt, blob.type);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Revoked on the next tick — immediately would cancel the download
      // in some browsers before it has read the blob.
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      toast.error(t("downloadFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    setBusy(true);
    try {
      const response = await fetch(src);
      const blob = await response.blob();

      // The clipboard only accepts a small set of image types, and PNG is
      // the one every browser supports. A JPEG is re-encoded through a
      // canvas rather than refused.
      const png = blob.type === "image/png" ? blob : await toPng(blob);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);

      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Firefox has no `ClipboardItem` image support at all; saying so is
      // more useful than a generic failure.
      toast.error(t("copyUnsupported"));
    } finally {
      setBusy(false);
    }
  }

  const actions = (
    <>
      <ImageAction onClick={copy} disabled={busy} label={copied ? t("copied") : t("copy")}>
        {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      </ImageAction>
      <ImageAction onClick={download} disabled={busy} label={t("download")}>
        <Download className="size-3.5" />
      </ImageAction>
    </>
  );

  return (
    <>
      <figure className="group/image relative my-2 w-fit max-w-full">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t("view")}
          className="block overflow-hidden rounded-xl border border-line bg-surface-raised transition-colors hover:border-line-strong"
        >
          {/* Deliberately a plain <img>: the source is an auth-gated
              redirect to a signed URL, which next/image cannot optimize
              and would only add a failing round trip. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            loading="lazy"
            className="h-auto max-h-80 w-auto max-w-full object-contain"
          />
        </button>

        {/* Revealed on hover, but always reachable by keyboard. */}
        <figcaption
          className={cn(
            "absolute end-2 top-2 flex items-center gap-1 rounded-lg border border-line/60 bg-canvas/85 p-0.5",
            "opacity-0 backdrop-blur transition-opacity focus-within:opacity-100 group-hover/image:opacity-100",
          )}
        >
          {actions}
          <ImageAction onClick={() => setOpen(true)} label={t("view")}>
            <Expand className="size-3.5" />
          </ImageAction>
        </figcaption>
      </figure>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={alt || t("view")}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-canvas/95 p-4 backdrop-blur-sm"
        >
          <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
            {actions}
            <ImageAction onClick={() => setOpen(false)} label={t("close")}>
              <X className="size-3.5" />
            </ImageAction>
          </div>

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            onClick={(event) => event.stopPropagation()}
            className="max-h-[85dvh] max-w-full rounded-lg object-contain"
          />
        </div>
      ) : null}
    </>
  );
}

function ImageAction({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface-raised hover:text-foreground disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/** Re-encodes any image blob as PNG, which is what the clipboard accepts. */
async function toPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2d context");
  context.drawImage(bitmap, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("encode failed"))), "image/png");
  });
}

/** A filename from the prompt, so a saved file is identifiable later. */
function filenameFor(alt: string, mime: string): string {
  const extension = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const base =
    alt
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "image";
  return `${base}.${extension}`;
}
