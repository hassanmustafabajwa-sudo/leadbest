import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { AiProviderId } from "./ai-provider.server";

export type UserSettings = {
  ai_provider: AiProviderId;
  ai_model: string | null;
  lead_source: string;
};

const VALID_PROVIDERS: AiProviderId[] = ["lovable", "openrouter", "gemini"];

export async function loadUserSettings(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<UserSettings> {
  const { data, error } = await supabase
    .from("user_settings")
    .select("ai_provider, ai_model, lead_source")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Could not load settings: ${error.message}`);
  const provider = VALID_PROVIDERS.includes(data?.ai_provider as AiProviderId)
    ? (data!.ai_provider as AiProviderId)
    : "lovable";
  return {
    ai_provider: provider,
    ai_model: data?.ai_model ?? null,
    lead_source: data?.lead_source ?? "google_maps",
  };
}
