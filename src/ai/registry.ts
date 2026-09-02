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


// Resolves model fallback chain up to 5 hops.
export async function resolveFallbackChain(model: ModelRow): Promise<ModelRow[]> {
  const chain: ModelRow[] = [model];
  let current = model;
  for (let i = 0; i < 5 && current.fallback_model_id; i++) {
    const next = await getModelBySlugOrId(current.fallback_model_id);
    if (!next || chain.some((m) => m.id === next.id)) break;
    chain.push(next);
    current = next;
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

