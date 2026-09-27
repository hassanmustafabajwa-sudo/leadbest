import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Tables } from "@/integrations/supabase/types";
import { TARGET_SERVICES, DECISION_MAKER_ROLES } from "./people-search-shared";

export type DecisionMaker = Tables<"decision_makers">;

// ---------------------------------------------------------------------------
// Status (reuses the existing internet-research + AI configuration checks)
// ---------------------------------------------------------------------------

export const getDecisionMakersStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { firecrawlStatus } = await import("./online-search.server");
    const { isProviderConfigured } = await import("./ai-provider.server");
    const { loadUserSettings } = await import("./settings.server");
    const settings = await loadUserSettings(context.supabase, context.userId);
    const research = firecrawlStatus();
    const aiConfigured = isProviderConfigured(settings.ai_provider) || isProviderConfigured("gemini");
    return {
      research,
      aiConfigured,
      roles: DECISION_MAKER_ROLES,
      services: TARGET_SERVICES,
    };
  });

// ---------------------------------------------------------------------------
// Search (transient — nothing is saved until the user clicks "Save Lead")
// ---------------------------------------------------------------------------

const SearchInput = z.object({
  query: z.string().trim().min(2).max(160),
  location: z.string().trim().max(120).default(""),
  role: z.string().trim().max(60).default("Any"),
  service: z.string().trim().max(60).nullable().default(null),
});

export type DecisionMakerResult = {
  fullName: string | null;
  jobTitle: string | null;
  companyName: string | null;
  location: string | null;
  linkedinUrl: string | null;
  professionalEmail: string | null;
  professionalPhone: string | null;
  companyWebsite: string | null;
  evidence: string[];
  sourceUrls: string[];
  confidence: number;
  targetService: string | null;
};

export const searchDecisionMakers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SearchInput.parse(d))
  .handler(async ({ data, context }): Promise<{ ok: boolean; notConfigured?: boolean; error?: string; results: DecisionMakerResult[] }> => {
    const { firecrawlStatus } = await import("./online-search.server");
    const { isProviderConfigured, AiError } = await import("./ai-provider.server");
    const { loadUserSettings } = await import("./settings.server");
    const { searchDecisionMakers: runSearch } = await import("./decision-makers.server");

    const research = firecrawlStatus();
    if (!research.configured) {
      return { ok: false, notConfigured: true, error: research.detail, results: [] };
    }
    const settings = await loadUserSettings(context.supabase, context.userId);
    if (!isProviderConfigured(settings.ai_provider) && !isProviderConfigured("gemini")) {
      return {
        ok: false,
        notConfigured: true,
        error: `AI provider "${settings.ai_provider}" is not configured. Open Settings to fix it.`,
        results: [],
      };
    }

    try {
      const results = await runSearch({
        query: data.query,
        location: data.location,
        role: data.role,
        service: data.service,
        provider: settings.ai_provider,
        model: settings.ai_model,
      });
      const withService = results.map((r) => ({ ...r, targetService: data.service }));
      return { ok: true, results: withService };
    } catch (e) {
      const msg = e instanceof AiError ? e.message : (e as Error).message;
      return { ok: false, error: msg, results: [] };
    }
  });

// ---------------------------------------------------------------------------
// Enrich a single result (still transient; client re-saves if they want it kept)
// ---------------------------------------------------------------------------

const PersonInput = z.object({
  fullName: z.string().nullable(),
  jobTitle: z.string().nullable(),
  companyName: z.string().nullable(),
  location: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
  professionalEmail: z.string().nullable(),
  professionalPhone: z.string().nullable(),
  companyWebsite: z.string().nullable(),
  evidence: z.array(z.string()),
  sourceUrls: z.array(z.string()),
  confidence: z.number(),
  targetService: z.string().nullable(),
});

export const enrichDecisionMaker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PersonInput.parse(d))
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string; result?: DecisionMakerResult }> => {
    const { firecrawlStatus } = await import("./online-search.server");
    const { AiError } = await import("./ai-provider.server");
    const { loadUserSettings } = await import("./settings.server");
    const { enrichPerson } = await import("./decision-makers.server");

    const research = firecrawlStatus();
    if (!research.configured) return { ok: false, error: research.detail };

    const settings = await loadUserSettings(context.supabase, context.userId);
    try {
      const enriched = await enrichPerson(data, settings.ai_provider, settings.ai_model);
      return { ok: true, result: { ...enriched, targetService: data.targetService } };
    } catch (e) {
      const msg = e instanceof AiError ? e.message : (e as Error).message;
      return { ok: false, error: msg };
    }
  });

// ---------------------------------------------------------------------------
// Save / list / delete
// ---------------------------------------------------------------------------

export const saveDecisionMaker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PersonInput.parse(d))
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string; duplicate?: boolean; id?: string }> => {
    if (!data.fullName || !data.companyName) {
      return { ok: false, error: "A decision maker needs at least a name and a company to be saved." };
    }
    const { decisionMakerMatchKey } = await import("./decision-makers.server");
    const matchKey = decisionMakerMatchKey({ fullName: data.fullName, companyName: data.companyName, jobTitle: data.jobTitle });

    const { data: row, error } = await context.supabase
      .from("decision_makers")
      .upsert(
        {
          user_id: context.userId,
          full_name: data.fullName,
          job_title: data.jobTitle,
          company_name: data.companyName,
          location: data.location,
          linkedin_url: data.linkedinUrl,
          professional_email: data.professionalEmail,
          professional_phone: data.professionalPhone,
          company_website: data.companyWebsite,
          source_urls: data.sourceUrls,
          evidence: data.evidence,
          confidence: Math.round(data.confidence),
          target_service: data.targetService,
          match_key: matchKey,
        },
        { onConflict: "user_id,match_key" },
      )
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: row.id };
  });

export const listDecisionMakers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("decision_makers")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const IdInput = z.object({ id: z.string().uuid() });

export const deleteDecisionMaker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("decision_makers").delete().eq("id", data.id).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

// ---------------------------------------------------------------------------
// Convert a saved decision maker into a regular Lead
// ---------------------------------------------------------------------------

export const importDecisionMakerAsLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: dm, error } = await context.supabase
      .from("decision_makers")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .single();
    if (error) throw new Error(error.message);
    if (dm.imported_lead_id) return { ok: true as const, duplicate: true, leadId: dm.imported_lead_id };

    const nameParts = dm.full_name.trim().split(/\s+/);
    const { data: lead, error: insErr } = await context.supabase
      .from("leads")
      .insert({
        user_id: context.userId,
        company_name: dm.company_name,
        first_name: nameParts[0] ?? null,
        last_name: nameParts.length > 1 ? nameParts.slice(1).join(" ") : null,
        industry: null,
        address: null,
        city: dm.location,
        country: null,
        website: dm.company_website,
        email: dm.professional_email,
        phone: dm.professional_phone,
        maps_url: null,
        rating: null,
        review_count: null,
        description: dm.job_title ? `${dm.job_title} at ${dm.company_name}` : null,
        source: "decision_makers",
        source_id: dm.id,
        recommended_service: dm.target_service,
        qualification_status: "new",
        outreach_status: "none",
      })
      .select("id")
      .single();
    if (insErr) {
      if (insErr.code === "23505") return { ok: true as const, duplicate: true };
      throw new Error(insErr.message);
    }
    await context.supabase.from("decision_makers").update({ imported_lead_id: lead.id }).eq("id", dm.id);
    return { ok: true as const, duplicate: false, leadId: lead.id };
  });
