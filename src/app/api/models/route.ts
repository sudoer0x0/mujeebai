import { NextResponse } from "next/server";
import { getCurrentUser } from "@/auth/session";
import { listModels } from "@/ai/registry";
import { getEffectiveBoolean } from "@/billing/entitlements";

// Public model listing for model selector.
export async function GET() {
  const models = await listModels();
  const user = await getCurrentUser();

  const premium = user ? await getEffectiveBoolean(user.id, "premium_models", false) : false;
  const advanced = user ? await getEffectiveBoolean(user.id, "advanced_models", false) : false;

  const payload = models.map((model) => ({
    slug: model.slug,
    displayName: model.display_name,
    description: model.description,
    capabilities: model.capabilities,
    tier: model.tier,
    availability: model.availability,
    unlocked:
      model.availability === "available" &&
      (model.tier === "free" || (model.tier === "pro" && premium) || (["premium", "experimental"].includes(model.tier) && advanced)),
  }));

  return NextResponse.json({ models: payload });
}
