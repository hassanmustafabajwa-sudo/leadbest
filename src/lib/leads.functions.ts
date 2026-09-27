import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Tables } from "@/integrations/supabase/types";

export type Lead = Tables<"leads">;

// ---------------------------------------------------------------------------
// Lead source status + import
// ---------------------------------------------------------------------------

export const getLeadSourceStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { listLeadSources } = await import("./lead-source.server");
    const { loadUserSettings } = await import("./settings.server");
    const settings = await loadUserSettings(context.supabase, context.userId);
    return { sources: listLeadSources(), active: settings.lead_source };
  });

const SearchInput = z.object({
  keyword: z.string().trim().min(2).max(120),
  location: z.string().trim().min(2).max(120),
  limit: z.number().int().min(1).max(60),
});

function normalizeDomain(url: string | null): string | null {
  if (!url) return null;
  try {
    const host = new URL(url.startsWith("http") ? url : `https://${url}`).hostname.toLowerCase();
    return host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export const searchAndImportLeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SearchInput.parse(d))
  .handler(async ({ data, context }) => {
    const { getLeadSource, LeadSourceError } = await import("./lead-source.server");
    const { loadUserSettings } = await import("./settings.server");
    const settings = await loadUserSettings(context.supabase, context.userId);
    const source = getLeadSource(settings.lead_source);
    const status = source.status();
    if (!status.configured) {
      return { ok: false as const, error: status.detail, notConfigured: true };
    }

    let businesses;
    try {
      businesses = await source.searchBusinesses(data.keyword, data.location, data.limit);
    } catch (e) {
      const msg = e instanceof LeadSourceError ? e.message : `Lead source failed: ${(e as Error).message}`;
      return { ok: false as const, error: msg, notConfigured: false };
    }

    if (businesses.length === 0) {
      return { ok: true as const, found: 0, imported: 0, duplicates: 0, failed: [] as string[], importedIds: [] as string[] };
    }

    // Dedupe against existing rows by source_id, then by website domain.
    const sourceIds = businesses.map((b) => b.source_id);
    const { data: existingBySource } = await context.supabase
      .from("leads")
      .select("source_id")
      .eq("user_id", context.userId)
      .eq("source", source.id)
      .in("source_id", sourceIds);
    const knownSourceIds = new Set((existingBySource ?? []).map((r) => r.source_id));

    const domains = businesses.map((b) => normalizeDomain(b.website)).filter((d): d is string => !!d);
    const knownDomains = new Set<string>();
    if (domains.length) {
      const { data: existingSites } = await context.supabase
        .from("leads")
        .select("website")
        .eq("user_id", context.userId)
        .not("website", "is", null);
      for (const r of existingSites ?? []) {
        const d = normalizeDomain(r.website);
        if (d) knownDomains.add(d);
      }
    }

    let duplicates = 0;
    const failed: string[] = [];
    const toInsert: Array<
      Omit<Lead, "id" | "created_at" | "updated_at" | "contact_page_url" | "enriched_at" | "enrichment_error" | "enrichment_status" | "social_links">
    > = [];
    const seenInBatch = new Set<string>();
    for (const b of businesses) {
      const domain = normalizeDomain(b.website);
      if (knownSourceIds.has(b.source_id) || (domain && knownDomains.has(domain)) || seenInBatch.has(b.source_id)) {
        duplicates++;
        continue;
      }
      seenInBatch.add(b.source_id);
      if (domain) knownDomains.add(domain);
      toInsert.push({
        user_id: context.userId,
        company_name: b.company_name,
        first_name: null,
        last_name: null,
        industry: b.industry,
        address: b.address,
        city: b.city,
        country: b.country,
        website: b.website,
        email: null,
        phone: b.phone,
        maps_url: b.maps_url,
        rating: b.rating,
        review_count: b.review_count,
        description: b.description,
        source: b.source,
        source_id: b.source_id,
        ai_score: null,
        ai_analysis: null,
        recommended_service: null,
        qualification_status: "new",
        outreach_status: "none",
      });
    }

    let imported = 0;
    const importedIds: string[] = [];
    if (toInsert.length) {
      const { data: inserted, error } = await context.supabase
        .from("leads")
        .upsert(toInsert, { onConflict: "user_id,source,source_id", ignoreDuplicates: true })
        .select("id");
      if (error) {
        console.error("[leads] insert failed", error);
        // Fall back to row-by-row so one bad row does not block the batch.
        for (const row of toInsert) {
          const { data: one, error: e2 } = await context.supabase.from("leads").insert(row).select("id").single();
          if (e2) failed.push(`${row.company_name}: ${e2.message}`);
          else {
            imported++;
            if (one?.id) importedIds.push(one.id);
          }
        }
      } else {
        imported = inserted?.length ?? 0;
        for (const r of inserted ?? []) importedIds.push(r.id);
      }
    }

    return { ok: true as const, found: businesses.length, imported, duplicates, failed, importedIds };
  });

// ---------------------------------------------------------------------------
// AI analysis
// ---------------------------------------------------------------------------

const AnalyzeInput = z.object({ leadIds: z.array(z.string().uuid()).min(1).max(5) });

export type AnalyzeResult = {
  leadId: string;
  ok: boolean;
  error?: string;
  score?: number;
  qualification?: string;
};

/**
 * Analyzes a small batch of leads sequentially. The client calls this in
 * chunks so it can show progress and so we never fan out hundreds of
 * concurrent AI requests.
 */
export const analyzeLeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AnalyzeInput.parse(d))
  .handler(async ({ data, context }) => {
    const { analyzeLeadWithAi } = await import("./lead-analysis.server");
    const { isProviderConfigured, AiError } = await import("./ai-provider.server");
    const { loadUserSettings } = await import("./settings.server");
    const settings = await loadUserSettings(context.supabase, context.userId);

    if (!isProviderConfigured(settings.ai_provider) && !isProviderConfigured("gemini")) {
      return {
        notConfigured: true as const,
        error: `AI provider "${settings.ai_provider}" is not configured. Open Settings to fix it.`,
        results: [] as AnalyzeResult[],
      };
    }

    const { data: leads, error } = await context.supabase
      .from("leads")
      .select("*")
      .in("id", data.leadIds)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);

    const results: AnalyzeResult[] = [];
    for (const lead of leads ?? []) {
      try {
        const run = await analyzeLeadWithAi(
          { ...lead, rating: lead.rating === null ? null : Number(lead.rating) },
          settings.ai_provider,
          settings.ai_model,
        );
        const analysis = run.data;
        const { error: upErr } = await context.supabase
          .from("leads")
          .update({
            ai_score: analysis.score,
            ai_analysis: {
              ...analysis,
              provider: run.provider,
              model: run.model,
              used_fallback: run.usedFallback,
              analyzed_at: new Date().toISOString(),
            },
            recommended_service: analysis.recommended_service,
            qualification_status: analysis.qualification,
          })
          .eq("id", lead.id);
        if (upErr) throw new Error(`Saved analysis failed: ${upErr.message}`);
        results.push({ leadId: lead.id, ok: true, score: analysis.score, qualification: analysis.qualification });
      } catch (e) {
        const msg = e instanceof AiError ? e.message : (e as Error).message;
        console.error(`[ai] lead ${lead.id} failed: ${msg}`);
        results.push({ leadId: lead.id, ok: false, error: msg });
        // Stop the whole batch on config/auth/payment errors: retrying would fail identically.
        if (e instanceof AiError && (e.kind === "auth" || e.kind === "config" || e.kind === "payment")) {
          return { notConfigured: false as const, error: msg, results, fatal: true as const };
        }
      }
    }
    return { notConfigured: false as const, results };
  });

// ---------------------------------------------------------------------------
// Website enrichment (contact email + social links)
// ---------------------------------------------------------------------------

const EnrichInput = z.object({ leadIds: z.array(z.string().uuid()).min(1).max(5) });

export type EnrichResult = {
  leadId: string;
  company: string;
  status: "found" | "partial" | "nothing" | "no_website" | "failed";
  email?: string | null;
  socialCount?: number;
  error?: string;
};

/**
 * Visits each lead's website and saves any contact email and social profile
 * links found on the page. Nothing is guessed: if the site has no address,
 * the lead keeps an empty email.
 */
export const enrichLeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => EnrichInput.parse(d))
  .handler(async ({ data, context }) => {
    const { enrichFromWebsite, EnrichmentError } = await import("./enrichment.server");

    const { data: leads, error } = await context.supabase
      .from("leads")
      .select("id, company_name, website, email")
      .in("id", data.leadIds)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);

    const results: EnrichResult[] = [];
    for (const lead of leads ?? []) {
      if (!lead.website) {
        await context.supabase
          .from("leads")
          .update({ enrichment_status: "no_website", enrichment_error: null, enriched_at: new Date().toISOString() })
          .eq("id", lead.id);
        results.push({ leadId: lead.id, company: lead.company_name, status: "no_website" });
        continue;
      }
      try {
        const found = await enrichFromWebsite(lead.website);
        const socialCount = Object.keys(found.socials).length;
        const status = found.email && socialCount ? "found" : found.email || socialCount ? "partial" : "nothing";
        const { error: upErr } = await context.supabase
          .from("leads")
          .update({
            email: lead.email ?? found.email,
            social_links: socialCount ? found.socials : null,
            contact_page_url: found.contactPageUrl,
            enrichment_status: status,
            enrichment_error: null,
            enriched_at: new Date().toISOString(),
          })
          .eq("id", lead.id);
        if (upErr) throw new Error(`Saving contact details failed: ${upErr.message}`);
        results.push({
          leadId: lead.id,
          company: lead.company_name,
          status,
          email: lead.email ?? found.email,
          socialCount,
        });
      } catch (e) {
        const msg = e instanceof EnrichmentError ? e.message : (e as Error).message;
        console.error(`[enrich] lead ${lead.id} failed: ${msg}`);
        await context.supabase
          .from("leads")
          .update({ enrichment_status: "failed", enrichment_error: msg, enriched_at: new Date().toISOString() })
          .eq("id", lead.id);
        results.push({ leadId: lead.id, company: lead.company_name, status: "failed", error: msg });
      }
    }
    return { results };
  });
