"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Download, Copy, Check, X, FileText, ExternalLink, Music, Video } from "lucide-react";
import { toast } from "@/components/ui/toast";
import type { UiAttachment } from "@/components/chat/types";

export interface AttachmentModalProps {
  attachment: UiAttachment | null;
  onClose: () => void;
}

/** Re-encodes any image blob as PNG for clipboard compatibility */
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

export function AttachmentModal({ attachment, onClose }: AttachmentModalProps) {
  const t = useTranslations("chat.image");
  const [copied, setCopied] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useEffect(() => {
    if (!attachment) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;

    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [attachment, onClose]);

  if (!mounted || !attachment) return null;

  const isImage = attachment.kind === "image";
  const isVideo = attachment.kind === "video";
  const isAudio = attachment.kind === "audio";
  const url = `/api/attachments/${attachment.id}`;

  async function download() {
    if (!attachment) return;
    setBusy(true);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(String(response.status));

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = attachment.filename || (isImage ? "image.png" : "download");
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      toast.error(t("downloadFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function copyImage() {
    if (!attachment) return;
    setBusy(true);
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const png = blob.type === "image/png" ? blob : await toPng(blob);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);

      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error(t("copyUnsupported"));
    } finally {
      setBusy(false);
    }
  }

  const modalElement = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={attachment.filename}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-6 backdrop-blur-xs"
      onClick={onClose}
    >
      {isImage ? (
        <div
          className="relative flex max-h-[92vh] max-w-[95vw] flex-col items-center gap-3"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Top floating bar */}
          <div className="flex w-full items-center justify-between gap-3 rounded-full border border-white/10 bg-neutral-900/90 px-4 py-2 text-white shadow-xl backdrop-blur-md">
            <span className="max-w-xs sm:max-w-md truncate text-xs sm:text-sm font-medium text-neutral-200">
              {attachment.filename}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={copyImage}
                disabled={busy}
                aria-label={copied ? t("copied") : t("copy")}
                title={copied ? t("copied") : t("copy")}
                className="rounded-full p-1.5 text-neutral-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
              >
                {copied ? <Check className="size-4 text-emerald-400" /> : <Copy className="size-4" />}
              </button>
              <button
                type="button"
                onClick={download}
                disabled={busy}
                aria-label={t("download")}
                title={t("download")}
                className="rounded-full p-1.5 text-neutral-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
              >
                <Download className="size-4" />
              </button>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open in new tab"
                title="Open in new tab"
                className="rounded-full p-1.5 text-neutral-300 transition-colors hover:bg-white/10 hover:text-white"
              >
                <ExternalLink className="size-4" />
              </a>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("close")}
                title={t("close")}
                className="ml-1 rounded-full p-1.5 text-neutral-300 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          {/* Centered Image */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={attachment.filename}
            className="max-h-[82vh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
          />
        </div>
      ) : isVideo ? (
        <div
          className="relative flex max-h-[92vh] max-w-[95vw] flex-col items-center gap-3"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Top floating bar */}
          <div className="flex w-full items-center justify-between gap-3 rounded-full border border-white/10 bg-neutral-900/90 px-4 py-2 text-white shadow-xl backdrop-blur-md">
            <div className="flex items-center gap-2 min-w-0">
              <Video className="size-4 text-neutral-400 shrink-0" />
              <span className="max-w-xs sm:max-w-md truncate text-xs sm:text-sm font-medium text-neutral-200">
                {attachment.filename}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={download}
                disabled={busy}
                aria-label={t("download")}
                title={t("download")}
                className="rounded-full p-1.5 text-neutral-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
              >
                <Download className="size-4" />
              </button>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open in new tab"
                title="Open in new tab"
                className="rounded-full p-1.5 text-neutral-300 transition-colors hover:bg-white/10 hover:text-white"
              >
                <ExternalLink className="size-4" />
              </a>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("close")}
                title={t("close")}
                className="ml-1 rounded-full p-1.5 text-neutral-300 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          {/* Centered Video Player */}
          <video
            src={url}
            controls
            autoPlay
            className="max-h-[82vh] max-w-[92vw] rounded-lg shadow-2xl bg-black"
          />
        </div>
      ) : isAudio ? (
        <div
          className="relative flex flex-col items-center gap-4 rounded-2xl border border-line bg-surface p-6 sm:p-8 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex w-full items-center justify-between gap-4 pb-2 border-b border-line">
            <div className="flex items-center gap-2 min-w-0">
              <Music className="size-5 text-accent shrink-0" />
              <span className="max-w-xs sm:max-w-md truncate text-sm font-medium text-foreground">
                {attachment.filename}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={download}
                disabled={busy}
                aria-label={t("download")}
                title={t("download")}
                className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface-raised hover:text-foreground disabled:opacity-50"
              >
                <Download className="size-4" />
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("close")}
                title={t("close")}
                className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          <audio src={url} controls autoPlay className="w-72 sm:w-96 mt-2" />
        </div>
      ) : (
        <div
          className="relative flex h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-line bg-surface-raised px-4 py-3">
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="size-4 text-muted shrink-0" />
              <span className="truncate text-sm font-medium text-foreground">
                {attachment.filename}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={download}
                disabled={busy}
                aria-label={t("download")}
                title={t("download")}
                className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised disabled:opacity-50"
              >
                <Download className="size-3.5" />
                <span className="hidden sm:inline">{t("download")}</span>
              </button>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open in new tab"
                title="Open in new tab"
                className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface hover:text-foreground"
              >
                <ExternalLink className="size-4" />
              </a>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("close")}
                title={t("close")}
                className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          {/* Viewer Content (In-App Document / PDF / Text Preview) */}
          <div className="relative flex-1 bg-neutral-100 dark:bg-neutral-900">
            <iframe
              src={url}
              title={attachment.filename}
              className="h-full w-full border-0"
              sandbox="allow-scripts allow-same-origin allow-forms"
            />
          </div>
        </div>
      )}
    </div>
  );

  return createPortal(modalElement, document.body);
}
