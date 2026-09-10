import "server-only";
import { cache } from "react";
import { getRegistry } from "@/lib/cached-registry";
import { GatewayError } from "@/ai/types";
import type { Tables } from "@/types/database";

export type ModelRow = Tables<"models">;
export type ProviderRow = Tables<"providers">;

// Model and provider registry.
//
// Backed by the cross-request registry snapshot: this is global
// configuration identical for every visitor, and re-reading it per
// request was one of the larger fixed costs on the chat path.
export const listModels = cache(async (): Promise<ModelRow[]> => {
  const { models } = await getRegistry();
  if (models.length === 0) {
    throw new GatewayError("unknown", "Model registry is empty — check the seed migration.");
  }
  return models;
});

export const listProviders = cache(async (): Promise<ProviderRow[]> => {
  const { providers } = await getRegistry();
  return providers;
});

export async function getModelBySlug(slug: string): Promise<ModelRow | null> {
  const models = await listModels();
  return models.find((m) => m.slug === slug) ?? null;
}

export async function getProviderById(id: string): Promise<ProviderRow | null> {
  const providers = await listProviders();
  return providers.find((p) => p.id === id) ?? null;
}


/**
 * Known resilient free provider models on OpenRouter.
 * Used as alternative candidates when the primary free slot is rate-limited
 * or when an upstream provider returns 0 content tokens.
 */
export const FREE_FALLBACK_PROVIDERS = [
  "nvidia/nemotron-3.5-lightning:free",
  "liquid/lfm-2.5-2.6b:free",
  "poolside/laguna-s-2.1:free",
  "poolside/laguna-xs-2.1:free",
  "thinkingmachines/inkling:free",
  "openrouter/free",
];

// Resolves model fallback chain up to 5 hops, augmented with free candidate models.
export async function resolveFallbackChain(model: ModelRow): Promise<ModelRow[]> {
  const chain: ModelRow[] = [model];
  let current = model;
  for (let i = 0; i < 5 && current.fallback_model_id; i++) {
    const next = await getModelBySlugOrId(current.fallback_model_id);
    if (!next || chain.some((m) => m.id === next.id)) break;
    chain.push(next);
    current = next;
  }

  // If this is a free model, augment the chain with alternative free provider models
  // so that single-provider rate limits or blank streams are rescued seamlessly.
  if (model.tier === "free") {
    const existingProviderIds = new Set(chain.map((m) => m.provider_model_id));
    for (const fallbackId of FREE_FALLBACK_PROVIDERS) {
      if (!existingProviderIds.has(fallbackId)) {
        existingProviderIds.add(fallbackId);
        chain.push({
          ...model,
          provider_model_id: fallbackId,
        });
      }
    }
  }

  return chain;
}

async function getModelBySlugOrId(id: string): Promise<ModelRow | null> {
  const models = await listModels();
  return models.find((m) => m.id === id) ?? null;
}

export async function getDefaultModel(): Promise<ModelRow | null> {
  const models = await listModels();
  return models.find((m) => m.is_default && m.availability === "available") ?? models[0] ?? null;
}

