import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getSettingsOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { listAiProviders, getAiChainStatus } = await import("./ai-provider.server");
    const { listLeadSources } = await import("./lead-source.server");
    const { loadUserSettings } = await import("./settings.server");
    const { getGmailStatus } = await import("./gmail.server");
    const settings = await loadUserSettings(context.supabase, context.userId);
    const gmail = await getGmailStatus(context.userId);
    return {
      settings,
      aiProviders: listAiProviders(),
      aiChain: getAiChainStatus(),
      leadSources: listLeadSources(),
      gmail,
    };
  });

const SaveInput = z.object({
  ai_provider: z.enum(["lovable", "openrouter", "gemini"]),
  ai_model: z.string().trim().max(120).nullable(),
  lead_source: z.string().trim().min(1).max(60),
});

export const saveSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SaveInput.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("user_settings").upsert(
      {
        user_id: context.userId,
        ai_provider: data.ai_provider,
        ai_model: data.ai_model || null,
        lead_source: data.lead_source,
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
