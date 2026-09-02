import type { StreamChunk } from "@/ai/types";

// Streams chunks as NDJSON response.
export function streamChunksAsResponse(
  generator: AsyncGenerator<StreamChunk>,
  onSettled?: (chunks: StreamChunk[]) => void | Promise<void>,
  extraHeaders?: Record<string, string>,
): Response {
  const encoder = new TextEncoder();
  const collected: StreamChunk[] = [];

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await generator.next();
        if (done) {
          controller.close();
          if (onSettled) await onSettled(collected);
          return;
        }
        collected.push(value);
        controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown streaming error";
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", code: "unknown", message })}\n`));
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
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      ...extraHeaders,
    },
  });
}

/** Client-side counterpart: reads an NDJSON response body into StreamChunks. */
export async function* readNdjsonStream(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          yield JSON.parse(trimmed) as StreamChunk;
        } catch {
          // ignore malformed line
        }
      }
    }
    const remainder = buffer.trim();
    if (remainder) {
      try {
        yield JSON.parse(remainder) as StreamChunk;
      } catch {
        // ignore malformed line
      }
    }
  } finally {
    reader.releaseLock();
  }
}
