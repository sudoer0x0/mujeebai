import "server-only";
import { serverEnv, providerStatus } from "@/lib/env.server";
import { logger } from "@/lib/logger";
import { GatewayError, type ImageGenerationRequest, type ImageGenerationResult, type ImageProviderAdapter } from "@/ai/types";

// Cloudflare Workers AI image generation adapter.
export const cloudflareImageAdapter: ImageProviderAdapter = {
  slug: "cloudflare-images",

  async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    if (!providerStatus.cloudflareImages) {
      throw new GatewayError("not_configured", "Cloudflare Workers AI is not configured on this deployment.");
    }

    const url = `https://api.cloudflare.com/client/v4/accounts/${serverEnv.CLOUDFLARE_ACCOUNT_ID}/ai/run/${request.providerModelId}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serverEnv.CLOUDFLARE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildPayload(request)),
        signal: request.signal,
      });
    } catch (error) {
      logger.error("cloudflare_image_fetch_failed", { error: String(error) });
      throw new GatewayError("provider_unavailable", "Could not reach Cloudflare Workers AI.");
    }

    if (response.status === 429) {
      throw new GatewayError("rate_limited", "Cloudflare Workers AI rate limit reached.");
    }

    const contentType = response.headers.get("content-type") ?? "";

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      logger.error("cloudflare_image_error_response", { status: response.status, body: text.slice(0, 500) });
      throw new GatewayError("provider_error", `Cloudflare Workers AI returned ${response.status}.`);
    }

    // Flux/SDXL-style models return raw image bytes; some return JSON with
    // a base64 `image` field depending on the specific model — handle both.
    if (contentType.includes("application/json")) {
      const json = (await response.json()) as { result?: { image?: string } };
      const base64 = json.result?.image;
      if (!base64) {
        throw new GatewayError("provider_error", "Cloudflare Workers AI returned no image data.");
      }
      // Sniff, do not assume.
      //
      // This used to hardcode `image/png`, but `flux-1-schnell` returns
      // JPEG — and the app sends `X-Content-Type-Options: nosniff`, so a
      // JPEG served as `image/png` is one the browser refuses to render.
      // The label has to match the bytes, and only the bytes know.
      return { imageBase64: base64, contentType: sniffImageType(Buffer.from(base64, "base64")) };
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const imageBase64 = buffer.toString("base64");
    // Trust the provider's own header when it gave one, otherwise sniff.
    return {
      imageBase64,
      contentType: contentType.startsWith("image/") ? contentType : sniffImageType(buffer),
    };
  },
};

/**
 * Identifies an image from its leading bytes.
 *
 * Every format here is identified by a fixed signature at a known offset,
 * so this is a lookup rather than a guess. Falling back to PNG keeps a
 * response renderable in the common case while still being wrong loudly
 * enough to notice if a new format appears.
 */
function sniffImageType(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") return "image/png";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  if (buffer.length >= 6 && buffer.subarray(0, 6).toString("ascii").startsWith("GIF8")) return "image/gif";
  logger.warn("cloudflare_image_unknown_format", { magic: buffer.subarray(0, 8).toString("hex") });
  return "image/png";
}

/**
 * Builds the request body for the specific Workers AI model.
 *
 * Models on Workers AI do **not** share a schema, and the API rejects
 * unknown properties outright rather than ignoring them. Sending
 * `width`/`height` to `flux-1-schnell` fails the whole request with
 * `AiError: Bad input: Additional or unevaluated properties '/width,
 * /height' not allowed` — which is exactly how image generation was
 * broken: the adapter always sent them, so every Flux generation returned
 * 400 and surfaced as a generic "images.failed".
 *
 * Flux takes `prompt` and an optional `steps`; the Stable Diffusion family
 * takes `width`, `height` and `num_steps`. Anything unrecognised gets the
 * prompt alone, which is the only field every image model shares — a new
 * model added from the admin console then works by default instead of
 * failing on a parameter this code guessed at.
 */
function buildPayload(request: ImageGenerationRequest): Record<string, unknown> {
  const model = request.providerModelId.toLowerCase();

  if (model.includes("flux")) {
    // `steps` is capped at 8 for schnell; leaving it unset uses the
    // model's own default, which is the right call unless asked otherwise.
    return { prompt: request.prompt };
  }

  if (model.includes("stable-diffusion") || model.includes("sdxl") || model.includes("dreamshaper")) {
    return {
      prompt: request.prompt,
      width: request.width ?? 1024,
      height: request.height ?? 1024,
    };
  }

  return { prompt: request.prompt };
}
