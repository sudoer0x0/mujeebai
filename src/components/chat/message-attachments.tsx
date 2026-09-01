"use client";

import { FileText } from "lucide-react";
import type { UiAttachment } from "@/components/chat/types";

/**
 * Files sent with a message, shown under its bubble.
 *
 * Every attachment is addressed as `/api/attachments/<id>`, which
 * re-signs the private storage URL per request. Storing a signed URL on
 * the message would look fine for an hour and then break permanently.
 *
 * Images render as a thumbnail that opens full size; everything else
 * renders as a download chip, because a PDF preview is not something this
 * component can honestly provide.
 */
export function MessageAttachments({ attachments }: { attachments: UiAttachment[] }) {
  if (attachments.length === 0) return null;

  const images = attachments.filter((attachment) => attachment.kind === "image");
  const files = attachments.filter((attachment) => attachment.kind !== "image");

  return (
    <div className="mt-2 flex flex-col gap-2">
      {images.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {images.map((attachment) => (
            <a
              key={attachment.id}
              href={`/api/attachments/${attachment.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block overflow-hidden rounded-md border border-line transition-colors hover:border-line-strong"
            >
              {/* Deliberately a plain <img>: the source is an auth-gated
                  redirect to a signed URL, which next/image cannot
                  optimize and would only add a failing round trip. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/attachments/${attachment.id}`}
                alt={attachment.filename}
                loading="lazy"
                className="max-h-64 w-auto max-w-full object-contain"
              />
            </a>
          ))}
        </div>
      ) : null}

      {files.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {files.map((attachment) => (
            <li key={attachment.id}>
              <a
                href={`/api/attachments/${attachment.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-sm border border-line bg-surface px-2 py-1 text-[12px] text-foreground transition-colors hover:border-line-strong"
              >
                <FileText className="size-3.5 shrink-0 text-muted" aria-hidden />
                <span className="max-w-52 truncate">{attachment.filename}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
