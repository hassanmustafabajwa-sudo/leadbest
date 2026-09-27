import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Tables } from "@/integrations/supabase/types";
import { TARGET_SERVICES, DECISION_MAKER_ROLES } from "./people-search-shared";

export type LinkedInLead = Tables<"linkedin_leads">;

export const getLinkedInLeadsStatus = createServerFn({ method: "GET" })
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
// Search
// ---------------------------------------------------------------------------

const SearchInput = z.object({
  query: z.string().trim().min(2).max(160),
  location: z.string().trim().max(120).default(""),
  role: z.string().trim().max(60).default("Any"),
  service: z.string().trim().max(60).nullable().default(null),
});

export type LinkedInLeadResult = {
  fullName: string | null;
  jobTitle: string | null;
  companyName: string | null;
  location: string | null;
  headline: string | null;
  linkedinUrl: string | null;
  companyUrl: string | null;
  industry: string | null;
  seniority: string | null;
  professionalEmail: string | null;
  professionalPhone: string | null;
  companyEmail: string | null;
  companyPhone: string | null;
  sourceUrls: string[];
  evidence: string[];
  confidence: number;
  targetService: string | null;
  sourceType: string;
};

export const searchLinkedInLeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SearchInput.parse(d))
  .handler(async ({ data, context }): Promise<{ ok: boolean; notConfigured?: boolean; error?: string; results: LinkedInLeadResult[] }> => {
    const { firecrawlStatus } = await import("./online-search.server");
    const { isProviderConfigured, AiError } = await import("./ai-provider.server");
    const { loadUserSettings } = await import("./settings.server");
    const { searchLinkedInLeads: runSearch } = await import("./linkedin-leads.server");

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
      const withService = results.map((r) => ({ ...r, targetService: data.service, sourceType: "linkedin_public_search" }));
      return { ok: true, results: withService };
    } catch (e) {
      const msg = e instanceof AiError ? e.message : (e as Error).message;
      return { ok: false, error: msg, results: [] };
    }
  });

// ---------------------------------------------------------------------------
// Enrich
// ---------------------------------------------------------------------------

const LeadInput = z.object({
  fullName: z.string().nullable(),
  jobTitle: z.string().nullable(),
  companyName: z.string().nullable(),
  location: z.string().nullable(),
  headline: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
  companyUrl: z.string().nullable(),
  industry: z.string().nullable(),
  seniority: z.string().nullable(),
  professionalEmail: z.string().nullable(),
  professionalPhone: z.string().nullable(),
  companyEmail: z.string().nullable(),
  companyPhone: z.string().nullable(),
  sourceUrls: z.array(z.string()),
  evidence: z.array(z.string()),
  confidence: z.number(),
  targetService: z.string().nullable(),
  sourceType: z.string(),
});

export const enrichLinkedInLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => LeadInput.parse(d))
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string; result?: LinkedInLeadResult }> => {
    const { firecrawlStatus } = await import("./online-search.server");
    const { AiError } = await import("./ai-provider.server");
    const { loadUserSettings } = await import("./settings.server");
    const { enrichLinkedInLead: doEnrich } = await import("./linkedin-leads.server");

    const research = firecrawlStatus();
    if (!research.configured) return { ok: false, error: research.detail };

    const settings = await loadUserSettings(context.supabase, context.userId);
    try {
      const enriched = await doEnrich(data, settings.ai_provider, settings.ai_model);
      return {
        ok: true,
        result: { ...enriched, targetService: data.targetService, sourceType: data.sourceType || "linkedin_public_search" },
      };
    } catch (e) {
      const msg = e instanceof AiError ? e.message : (e as Error).message;
      return { ok: false, error: msg };
    }
  });

// ---------------------------------------------------------------------------
// Save / list / delete
// ---------------------------------------------------------------------------

export const saveLinkedInLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => LeadInput.parse(d))
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string; id?: string }> => {
    if (!data.fullName) {
      return { ok: false, error: "A LinkedIn lead needs at least a name to be saved." };
    }
    const { linkedInLeadMatchKey } = await import("./linkedin-leads.server");
    const matchKey = linkedInLeadMatchKey({
      fullName: data.fullName,
      companyName: data.companyName,
      jobTitle: data.jobTitle,
      linkedinUrl: data.linkedinUrl,
    });

    const { data: row, error } = await context.supabase
      .from("linkedin_leads")
      .upsert(
        {
          user_id: context.userId,
          full_name: data.fullName,
          job_title: data.jobTitle,
          company_name: data.companyName,
          location: data.location,
          headline: data.headline,
          linkedin_url: data.linkedinUrl,
          company_url: data.companyUrl,
          industry: data.industry,
          seniority: data.seniority,
          professional_email: data.professionalEmail,
          professional_phone: data.professionalPhone,
          company_email: data.companyEmail,
          company_phone: data.companyPhone,
          source_urls: data.sourceUrls,
          evidence: data.evidence,
          confidence: Math.round(data.confidence),
          target_service: data.targetService,
          source_type: data.sourceType || "linkedin_public_search",
          match_key: matchKey,
        },
        { onConflict: "user_id,match_key" },
      )
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: row.id };
  });

export const listLinkedInLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("linkedin_leads")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const IdInput = z.object({ id: z.string().uuid() });

export const deleteLinkedInLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("linkedin_leads").delete().eq("id", data.id).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const importLinkedInLeadAsLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: ll, error } = await context.supabase
      .from("linkedin_leads")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .single();
    if (error) throw new Error(error.message);
    if (ll.imported_lead_id) return { ok: true as const, duplicate: true, leadId: ll.imported_lead_id };

    const nameParts = ll.full_name.trim().split(/\s+/);
    const { data: lead, error: insErr } = await context.supabase
      .from("leads")
      .insert({
        user_id: context.userId,
        company_name: ll.company_name ?? ll.full_name,
        first_name: nameParts[0] ?? null,
        last_name: nameParts.length > 1 ? nameParts.slice(1).join(" ") : null,
        industry: ll.industry,
        address: null,
        city: ll.location,
        country: null,
        website: ll.company_url,
        email: ll.professional_email ?? ll.company_email,
        phone: ll.professional_phone ?? ll.company_phone,
        maps_url: null,
        rating: null,
        review_count: null,
        description: ll.headline ?? (ll.job_title && ll.company_name ? `${ll.job_title} at ${ll.company_name}` : null),
        source: "linkedin_leads",
        source_id: ll.id,
        recommended_service: ll.target_service,
        qualification_status: "new",
        outreach_status: "none",
      })
      .select("id")
      .single();
    if (insErr) {
      if (insErr.code === "23505") return { ok: true as const, duplicate: true };
      throw new Error(insErr.message);
    }
    await context.supabase.from("linkedin_leads").update({ imported_lead_id: lead.id }).eq("id", ll.id);
    return { ok: true as const, duplicate: false, leadId: lead.id };
  });
