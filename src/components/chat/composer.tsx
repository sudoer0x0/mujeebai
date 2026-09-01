"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { ArrowUp, Paperclip, Plus, Square, X, FileText, Image as ImageIcon, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { ModelSelector } from "@/components/chat/model-selector";
import { cn } from "@/lib/utils";
import type { UiAttachment } from "@/components/chat/types";

export interface PendingAttachment {
  id: string;
  filename: string;
  kind: string;
  status: "uploading" | "ready" | "failed";
  error?: string;
  /** Local preview URL, so an image shows before the upload finishes. */
  previewUrl?: string;
}

const MAX_TEXTAREA_HEIGHT = 200;

export function Composer({
  isStreaming,
  onSend,
  onStop,
  onGenerateImage,
  modelSlug,
  onModelChange,
  imageGenerationEnabled,
  fileUploadsEnabled,
  maxFileSizeMb,
  maxAttachments,
}: {
  isStreaming: boolean;
  onSend: (content: string, attachments: UiAttachment[]) => void;
  onStop: () => void;
  onGenerateImage: (prompt: string) => void;
  modelSlug: string | null;
  onModelChange: (slug: string) => void;
  imageGenerationEnabled: boolean;
  fileUploadsEnabled: boolean;
  maxFileSizeMb: number;
  /** Files allowed on one message — entitlement-driven, see migration 0017. */
  maxAttachments: number;
}) {
  const t = useTranslations("chat");
  const tImages = useTranslations("images");
  const tFiles = useTranslations("files");

  const [value, setValue] = React.useState("");
  const [attachments, setAttachments] = React.useState<PendingAttachment[]>([]);
  const [imageMode, setImageMode] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);

  /**
   * Whether the composer has outgrown a single line.
   *
   * Drives the layout change: on one line everything sits in a row, and
   * once the text wraps the controls drop to their own row beneath it so
   * the message gets the full width. Measured from the rendered height
   * rather than from character count, which would be wrong the moment
   * someone resizes the window or pastes a long unbroken URL.
   */
  const [expanded, setExpanded] = React.useState(false);

  /**
   * Height of the field holding exactly one line, measured from the
   * element on first layout.
   *
   * Hardcoding it did not survive contact with reality: padding, font size
   * and line height all feed into `scrollHeight`, and a guessed constant
   * put an *empty* composer over the threshold, so it rendered expanded
   * before anything had been typed.
   */
  const singleLineHeight = React.useRef<number | null>(null);

  // Nested elements fire dragenter/dragleave as the pointer crosses them,
  // so a boolean flag flickers. Counting enters and leaves is what keeps
  // the highlight steady while dragging over the composer's children.
  const dragDepth = React.useRef(0);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const uploading = attachments.some((attachment) => attachment.status === "uploading");
  const canSend = value.trim().length > 0 && !isStreaming && !uploading;

  /**
   * Grows with content up to a cap, then scrolls internally — an unbounded
   * textarea eventually pushes the send button off a phone screen.
   *
   * Measured in a layout effect rather than an effect: `scrollHeight` has
   * to be read and the height written before the browser paints, or the
   * field visibly flashes at its collapsed height for a frame on every
   * keystroke that wraps a line. That single-frame flicker is most of what
   * made the input feel cheap.
   *
   * The `auto` reset is required — without it `scrollHeight` can only ever
   * grow, so the field would never shrink when text is deleted.
   */
  React.useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;

    element.style.height = "auto";
    const natural = element.scrollHeight;

    // The first measurement happens with the field empty, which is by
    // definition one line.
    if (singleLineHeight.current === null) singleLineHeight.current = natural;

    const next = Math.min(natural, MAX_TEXTAREA_HEIGHT);
    element.style.height = `${next}px`;
    // Only scroll internally once the cap is reached; below it the field
    // is exactly as tall as its content and should not scroll at all.
    element.style.overflowY = element.scrollHeight > MAX_TEXTAREA_HEIGHT ? "auto" : "hidden";
    // Half a line of slack, so a tall glyph or a font swap cannot flip
    // the layout while the text is still on one line.
    const baseline = singleLineHeight.current ?? natural;
    setExpanded(natural > baseline * 1.5);
  }, [value]);

  function submit() {
    if (!canSend) return;
    const text = value.trim();

    if (imageMode) {
      onGenerateImage(text);
    } else {
      onSend(
        text,
        attachments
          .filter((attachment) => attachment.status === "ready")
          .map((attachment) => ({
            id: attachment.id,
            filename: attachment.filename,
            kind: attachment.kind,
          })),
      );
    }

    setValue("");
    // The message now owns the rendering of these files, so release the
    // local preview URLs rather than leaking one per upload.
    for (const attachment of attachments) {
      if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    }
    setAttachments([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  /**
   * Uploads one file and reconciles its chip.
   *
   * Split out from the picker handler so several files can be uploaded
   * concurrently rather than one after another — attaching five documents
   * should not take five round trips end to end.
   */
  async function uploadOne(file: File) {
    const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;

    setAttachments((previous) => [
      ...previous,
      {
        id: tempId,
        filename: file.name,
        kind: file.type.startsWith("image/") ? "image" : "other",
        status: "uploading",
        previewUrl,
      },
    ]);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/api/files", { method: "POST", body: formData });
      const data = await response.json();

      if (!response.ok) {
        setAttachments((previous) =>
          previous.map((attachment) =>
            attachment.id === tempId ? { ...attachment, status: "failed", error: data.error } : attachment,
          ),
        );
        toast.error(translateFileError(data.error));
        return;
      }

      setAttachments((previous) =>
        previous.map((attachment) =>
          attachment.id === tempId
            ? { id: data.id, filename: data.filename, kind: data.kind ?? attachment.kind, status: "ready", previewUrl }
            : attachment,
        ),
      );
    } catch {
      setAttachments((previous) =>
        previous.map((attachment) =>
          attachment.id === tempId ? { ...attachment, status: "failed" } : attachment,
        ),
      );
      toast.error(tFiles("failed"));
    }
  }

  /**
   * Accepts a batch of files from the picker or a drop.
   *
   * The count is checked against what is *already* attached, so selecting
   * three files twice cannot slip past a limit of five. Oversized files are
   * rejected before upload — sending 40 MB over a phone connection only to
   * be told it was too large wastes a minute and an allowance.
   */
  function addFiles(files: FileList | File[]) {
    const incoming = Array.from(files);
    if (incoming.length === 0) return;

    const room = maxAttachments - attachments.length;
    if (room <= 0) {
      toast.error(t("composer.attachmentLimit", { count: maxAttachments }));
      return;
    }

    const accepted: File[] = [];
    let rejectedForSize = 0;

    for (const file of incoming.slice(0, room)) {
      if (file.size > maxFileSizeMb * 1024 * 1024) {
        rejectedForSize += 1;
        continue;
      }
      accepted.push(file);
    }

    if (rejectedForSize > 0) toast.error(tFiles("tooLarge"));
    if (incoming.length > room) toast.error(t("composer.attachmentLimit", { count: maxAttachments }));

    // Concurrent, not sequential.
    for (const file of accepted) void uploadOne(file);
  }

  /**
   * Drag-and-drop.
   *
   * Accepts whatever the picker accepts — several images, a PDF and a
   * spreadsheet together, any mix — because `addFiles` applies the same
   * count, size and type rules either way. `dataTransfer.files` is not
   * live the way an input's FileList is, but it is copied here regardless:
   * the array is what the rest of the flow expects.
   */
  function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (!fileUploadsEnabled || imageMode) return;

    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length > 0) addFiles(files);
  }

  function handleDragEnter(event: React.DragEvent) {
    if (!fileUploadsEnabled || imageMode) return;
    // Only react to actual files — dragging selected text across the
    // composer should not offer to upload it.
    if (!Array.from(event.dataTransfer.types ?? []).includes("Files")) return;
    dragDepth.current += 1;
    setDragging(true);
  }

  function handleDragLeave() {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }

  /** The "+" menu. Rendered in the row or the control bar, never both. */
  function ComposerAddButton() {
    if (!fileUploadsEnabled || imageMode) {
      return imageMode ? (
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full"
          onClick={() => setImageMode(false)}
          aria-label={t("composer.exitImageMode")}
        >
          <X className="size-4" />
        </Button>
      ) : null;
    }

    return (
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            aria-label={t("composer.addContent")}
          >
            <Plus />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="w-60">
          <DropdownMenuItem
            // Two things are needed to open a file dialog from a menu
            // item. `preventDefault` stops Radix closing the menu and
            // restoring focus synchronously, and the deferred click runs
            // after that teardown — without both, the browser treats the
            // user-activation gesture as already spent and silently
            // refuses to open the picker.
            onSelect={(event) => {
              event.preventDefault();
              setMenuOpen(false);
              window.setTimeout(() => fileInputRef.current?.click(), 0);
            }}
            disabled={attachments.length >= maxAttachments}
          >
            <Paperclip className="size-4" aria-hidden />
            <span className="flex-1">{t("composer.uploadFiles")}</span>
            <span className="text-[11px] tabular-nums text-faint">
              {attachments.length}/{maxAttachments}
            </span>
          </DropdownMenuItem>
          {imageGenerationEnabled ? (
            <DropdownMenuItem
              onSelect={() => {
                setMenuOpen(false);
                setImageMode(true);
              }}
            >
              <ImageIcon className="size-4" aria-hidden />
              {t("composer.generateImage")}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    // Copy out of the FileList *before* resetting the input.
    //
    // `event.target.files` is a live FileList backed by the input, so
    // clearing `value` — which is what lets the same file be picked twice
    // in a row — also empties the list you are holding. Passing it along
    // afterwards handed `addFiles` zero files every time, which is why
    // attaching an image silently did nothing.
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length > 0) addFiles(files);
  }

  function translateFileError(key: unknown): string {
    if (key === "files.tooLarge") return tFiles("tooLarge");
    if (key === "files.unsupported") return tFiles("unsupported");
    return tFiles("failed");
  }

  return (
    // No top border. A hard rule across the width cut the composer off
    // from the conversation and made it read as a separate floating bar.
    // A short fade instead: messages scrolling underneath dissolve into
    // the page background rather than sliding under a line.
    <div className="relative bg-canvas px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-8 h-8 bg-gradient-to-t from-canvas to-transparent"
      />
      <form
        className="relative mx-auto flex w-full max-w-3xl flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        // `dragover` must be prevented or the browser opens the file
        // instead of letting the page handle the drop.
        onDragOver={(event) => {
          if (fileUploadsEnabled && !imageMode) event.preventDefault();
        }}
        onDrop={handleDrop}
      >
        {dragging ? (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-3xl border-2 border-dashed border-accent bg-canvas/85">
            <p className="text-[13px] font-medium text-accent">
              {t("composer.dropHint", { count: maxAttachments })}
            </p>
          </div>
        ) : null}
        {attachments.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {attachments.map((attachment) => (
              <li
                key={attachment.id}
                className={cn(
                  "flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[12px]",
                  attachment.status === "failed"
                    ? "border-danger/30 bg-danger-soft text-danger"
                    : "border-line bg-surface-raised text-foreground",
                )}
              >
                {attachment.status === "failed" ? (
                  <AlertCircle className="size-3.5 shrink-0" aria-hidden />
                ) : attachment.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- blob: URL, nothing for next/image to optimize
                  <img src={attachment.previewUrl} alt="" className="size-5 shrink-0 rounded-xs object-cover" />
                ) : (
                  <FileText className="size-3.5 shrink-0 text-muted" aria-hidden />
                )}
                <span className="max-w-40 truncate">{attachment.filename}</span>
                {attachment.status === "uploading" ? <Spinner className="size-3" label={tFiles("processing")} /> : null}
                <button
                  type="button"
                  onClick={() => {
                    if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
                    setAttachments((previous) => previous.filter((item) => item.id !== attachment.id));
                  }}
                  className="rounded-xs p-0.5 text-faint transition-colors hover:text-foreground"
                  aria-label={`${t("removeAttachment")} — ${attachment.filename}`}
                >
                  <X className="size-3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {/* The composer is one rounded surface holding everything that acts
            on the message: attachments menu, the text, the model, send.
            Grouping them means the eye lands in one place rather than
            tracking a toolbar above and a button below. */}
        {/* Two layouts, one surface.
            
            On a single line everything sits in a row: add, text, model,
            send. Once the text wraps, the controls drop beneath it so the
            message gets the full width — which is what makes a long
            prompt feel like it is being written rather than squeezed past
            a row of buttons.
            
            No border. A filled surface reads as a field on its own; the
            outline it used to carry was doing the same job twice and made
            the composer look boxed in. */}
        <div
          data-expanded={expanded ? "true" : "false"}
          className={cn(
            "composer-shell bg-surface-raised px-2",
            expanded ? "flex flex-col gap-1 rounded-3xl py-2" : "flex items-center gap-1 rounded-full py-1.5",
          )}
        >
          {fileUploadsEnabled && !imageMode ? (
            <input
              ref={fileInputRef}
              type="file"
              // `multiple` is what lets a user pick several documents at
              // once; the count is still bounded by the entitlement.
              multiple
              className="sr-only"
              onChange={handleFileSelect}
              aria-hidden
              tabIndex={-1}
            />
          ) : null}

          {/* Collapsed: the add button leads the row. Expanded: it moves
              to the control row below, so it is rendered twice and only
              one is mounted at a time. */}
          {!expanded ? <ComposerAddButton /> : null}

          <label htmlFor="composer-input" className="sr-only">
            {imageMode ? tImages("prompt.placeholder") : t("composer.placeholder")}
          </label>
          <textarea
            id="composer-input"
            ref={textareaRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends, Shift+Enter inserts a newline. `isComposing`
              // matters for Japanese and Chinese input: without it, Enter
              // to accept an IME candidate would send the message instead.
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={imageMode ? tImages("prompt.placeholder") : t("composer.placeholder")}
            rows={1}
            className={cn(
              "composer-input w-full resize-none bg-transparent text-[14px] leading-relaxed text-foreground",
              "placeholder:text-faint focus:outline-none [field-sizing:content]",
              expanded ? "max-h-[200px] px-2 py-1.5" : "max-h-[200px] min-h-6 flex-1 px-1.5 py-1",
            )}
          />

          <div className={cn("flex items-center gap-1", expanded && "justify-between")}>
            {expanded ? (
              <div className="flex items-center gap-1">
                {fileUploadsEnabled && !imageMode ? <ComposerAddButton /> : null}
              </div>
            ) : null}

            <div className="flex items-center gap-1">
              {!imageMode ? <ModelSelector value={modelSlug} onChange={onModelChange} compact /> : null}

              {isStreaming ? (
                <Button
                  variant="danger"
                  size="icon"
                  className="rounded-full"
                  onClick={onStop}
                  aria-label={t("composer.stop")}
                >
                  <Square className="size-3" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon"
                  className="rounded-full"
                  disabled={!canSend}
                  aria-label={t("composer.send")}
                >
                  <ArrowUp />
                </Button>
              )}
            </div>
          </div>
        </div>

        <p className="text-center text-[11px] text-faint">{t("composer.disclaimer")}</p>
      </form>
    </div>
  );
}
