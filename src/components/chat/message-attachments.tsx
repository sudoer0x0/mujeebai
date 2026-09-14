"use client";

import * as React from "react";
import { FileText, Video, Music } from "lucide-react";
import { AttachmentModal } from "@/components/chat/attachment-modal";
import type { UiAttachment } from "@/components/chat/types";

/**
 * Files sent with a message, shown as neat capsule cards matching the reference design.
 *
 * Every attachment is addressed as `/api/attachments/<id>`, which
 * re-signs the private storage URL per request.
 *
 * Clicking an attachment opens an in-app lightbox modal for images or an
 * in-app document viewer for files, PDFs, audio, and video.
 */
export function MessageAttachments({ attachments }: { attachments: UiAttachment[] }) {
  const [activeAttachment, setActiveAttachment] = React.useState<UiAttachment | null>(null);

  if (!attachments || attachments.length === 0) return null;

  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-2 max-w-full">
        {attachments.map((attachment) => (
          <button
            key={attachment.id}
            type="button"
            onClick={() => setActiveAttachment(attachment)}
            className="group inline-flex items-center gap-2 rounded-xl border border-line/60 dark:border-white/10 bg-surface-raised/80 hover:bg-surface-raised dark:bg-[#1e1e20]/90 dark:hover:bg-[#28282b] px-3 py-1.5 text-xs text-foreground/90 transition-all duration-150 shadow-xs focus:outline-hidden focus:ring-2 focus:ring-accent cursor-pointer"
            title={attachment.filename}
            aria-label={`Open ${attachment.filename}`}
          >
            {attachment.kind === "image" ? (
              <div className="relative size-6 shrink-0 overflow-hidden rounded-md border border-line/50 dark:border-white/10 bg-black/20">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/attachments/${attachment.id}`}
                  alt=""
                  loading="lazy"
                  className="size-full object-cover"
                />
              </div>
            ) : attachment.kind === "video" ? (
              <Video className="size-4 shrink-0 text-muted" aria-hidden />
            ) : attachment.kind === "audio" ? (
              <Music className="size-4 shrink-0 text-muted" aria-hidden />
            ) : (
              <FileText className="size-4 shrink-0 text-muted" aria-hidden />
            )}
            <span className="max-w-44 sm:max-w-56 truncate font-normal text-foreground/90">
              {attachment.filename}
            </span>
          </button>
        ))}
      </div>

      <AttachmentModal
        attachment={activeAttachment}
        onClose={() => setActiveAttachment(null)}
      />
    </>
  );
}
