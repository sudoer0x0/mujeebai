import type { StreamChunk } from "@/ai/types";

/**
 * Server-sent events, not newline-delimited JSON.
 *
 * ## Why the format changed
 *
 * This used to send `application/x-ndjson`. That works locally and fails
 * in production behind a CDN: an unrecognised content type is treated as
 * a normal response and **buffered** until it completes, so the reply
 * arrived all at once at the end — or, if the connection was held open
 * long enough, appeared not to arrive at all until the page was reloaded
 * and the persisted message was read from the database.
 *
 * `text/event-stream` is the one streaming format proxies and CDNs are
 * built to pass through untouched. The wire format is a detail; the
 * delivery guarantee is the point.
 *
 * ## The opening comment
 *
 * An SSE comment (`: open`) is written before anything else, so bytes
 * reach the browser the moment the model call is made rather than when
 * the first token arrives. That flushes the response headers through
 * every intermediary immediately, and it means a slow model shows a live
 * connection instead of a page that looks stalled.
 */
export function streamChunksAsResponse(
  /**
   * The model call, as something not yet awaited.
   *
   * Taking a promise rather than a ready generator is what lets the
   * response exist before the provider has answered. It used to take the
   * generator, so the caller had to await the model connection first and
   * the `Response` — headers included — did not exist for several
   * seconds. Nothing reached the browser in that window, so a slow model
   * was indistinguishable from a broken page.
   */
  start: Promise<AsyncGenerator<StreamChunk>> | AsyncGenerator<StreamChunk>,
  onSettled?: (chunks: StreamChunk[]) => void | Promise<void>,
  extraHeaders?: Record<string, string>,
): Response {
  const encoder = new TextEncoder();
  const collected: StreamChunk[] = [];
  let opened = false;
  let generator: AsyncGenerator<StreamChunk> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!opened) {
        opened = true;
        // Bytes now, before the provider has said anything. This flushes
        // the headers through every intermediary and tells the browser
        // the connection is live.
        controller.enqueue(encoder.encode(": open\n\n"));
        return;
      }

      try {
        if (!generator) {
          generator = await start;
        }
        const { value, done } = await generator.next();
        if (done) {
          // An explicit terminator. Without it a client cannot tell a
          // finished reply from a dropped connection, which is what left
          // the caret blinking after the model had stopped.
          controller.enqueue(encoder.encode("event: end\ndata: {}\n\n"));
          controller.close();
          if (onSettled) await onSettled(collected);
          return;
        }
        collected.push(value);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown streaming error";
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "error", code: "unknown", message })}\n\n`),
        );
        controller.enqueue(encoder.encode("event: end\ndata: {}\n\n"));
        controller.close();
        if (onSettled) await onSettled(collected);
      }
    },
    async cancel() {
      // Client aborted (stop button / navigation away). Let the caller
      // persist whatever was collected so far as a "stopped" message.
      if (onSettled) await onSettled(collected);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // nginx; Cloudflare honours the content type instead.
      "X-Accel-Buffering": "no",
      ...extraHeaders,
    },
  });
}

/** True once the stream has said it is finished, rather than merely gone quiet. */
export const STREAM_END = Symbol("stream-end");

/**
 * Client-side counterpart: reads an SSE body into StreamChunks.
 *
 * Yields `STREAM_END` when the server sends its terminator, so the caller
 * can distinguish "the model finished" from "the connection dropped".
 */
export async function* readEventStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamChunk | typeof STREAM_END> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Frames are separated by a blank line. Anything after the last one
      // is a partial frame and stays in the buffer.
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        let event = "message";
        const dataLines: string[] = [];

        for (const line of frame.split("\n")) {
          if (line.startsWith(":")) continue; // comment / keep-alive
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
        }

        if (event === "end") {
          yield STREAM_END;
          continue;
        }
        if (dataLines.length === 0) continue;

        try {
          yield JSON.parse(dataLines.join("\n")) as StreamChunk;
        } catch {
          // A malformed frame is skipped rather than killing the stream.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
