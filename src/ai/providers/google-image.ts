import "server-only";
import { serverEnv, providerStatus } from "@/lib/env.server";
import { logger } from "@/lib/logger";
import { cloudflareImageAdapter } from "@/ai/providers/cloudflare-image";
import { GatewayError, type ImageGenerationRequest, type ImageGenerationResult, type ImageProviderAdapter } from "@/ai/types";

export const googleImageAdapter: ImageProviderAdapter = {
  slug: "google-image",

  async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const apiKey = serverEnv.GEMINI_IMAGE_API_KEY || serverEnv.GEMINI_API_KEY;

    if (apiKey) {
      try {
        const model = request.providerModelId || "gemini-2.5-flash-image";
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [{ text: request.prompt }],
              },
            ],
          }),
          signal: request.signal,
        });

        if (response.ok) {
          const json = await response.json();
          // Check for image data in candidates
          const parts = json.candidates?.[0]?.content?.parts || [];
          for (const part of parts) {
            if (part.inlineData?.data) {
              return {
                imageBase64: part.inlineData.data,
                contentType: part.inlineData.mimeType || "image/png",
              };
            }
          }
        } else {
          const errorText = await response.text().catch(() => "");
          logger.warn("google_image_quota_or_unavailable", {
            status: response.status,
            body: errorText.slice(0, 300),
          });
        }
      } catch (err: unknown) {
        logger.warn("google_image_attempt_failed", { error: String(err) });
      }
    }

    // High-res watermark-free free fallback: Cloudflare Workers AI Flux-1-schnell
    if (providerStatus.cloudflareImages) {
      logger.info("falling_back_to_cloudflare_flux_images");
      return cloudflareImageAdapter.generateImage({
        prompt: request.prompt,
        providerModelId: serverEnv.CLOUDFLARE_IMAGE_MODEL,
        signal: request.signal,
      });
    }

    throw new GatewayError("provider_unavailable", "No available image generation provider configured.");
  },
};
