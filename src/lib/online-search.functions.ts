import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Tables } from "@/integrations/supabase/types";
import type * as OS from "./online-search.server";

export type SearchRun = Tables<"search_runs">;
export type SearchResultRow = Tables<"search_results">;

export const SEARCH_STAGES = ["maps", "web", "social", "directory", "verify"] as const;
export type SearchStage = (typeof SEARCH_STAGES)[number];

export const STAGE_LABELS: Record<SearchStage, string> = {
  maps: "Checking map listings",
  web: "Searching the web",
  social: "Searching social platforms",
  directory: "Checking business directories",
  verify: "Checking which businesses have a real website",
};

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export const getOnlineSearchStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { firecrawlStatus } = await import("./online-search.server");
    const { listLeadSources } = await import("./lead-source.server");
    const maps = listLeadSources().find((s) => s.id === "google_maps");
    return {
      research: firecrawlStatus(),
      maps: maps ? { configured: maps.configured, detail: maps.detail, name: maps.name } : null,
    };
  });

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

const StartInput = z.object({
  niche: z.string().trim().min(2).max(120),
  location: z.string().trim().min(2).max(120),
  minLeads: z.number().int().min(1).max(200).nullable(),
  maxLeads: z.number().int().min(1).max(200).nullable(),
});

export const startOnlineSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => StartInput.parse(d))
  .handler(async ({ data, context }) => {
    const { firecrawlStatus } = await import("./online-search.server");
    const status = firecrawlStatus();
    if (!status.configured) {
      return { ok: false as const, notConfigured: true, error: status.detail };
    }
    const { data: run, error } = await context.supabase
      .from("search_runs")
      .insert({
        user_id: context.userId,
        niche: data.niche,
        location: data.location,
        min_leads: data.minLeads,
        max_leads: data.maxLeads,
        status: "running",
        rounds: 1,
      })
      .select("*")
      .single();
    if (error) throw new Error(`Could not start the search: ${error.message}`);
    return { ok: true as const, run };
  });

export const listSearchRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("search_runs")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(15);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const RunIdInput = z.object({ runId: z.string().uuid() });

export const listSearchResults = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RunIdInput.parse(d))
  .handler(async ({ data, context }) => {
    const [{ data: run }, { data: results, error }] = await Promise.all([
      context.supabase.from("search_runs").select("*").eq("id", data.runId).maybeSingle(),
      context.supabase
        .from("search_results")
        .select("*")
        .eq("run_id", data.runId)
        .order("quality_score", { ascending: false }),
    ]);
    if (error) throw new Error(error.message);
    return { run: run ?? null, results: results ?? [] };
  });

export const deleteSearchRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RunIdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("search_runs").delete().eq("id", data.runId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const expandSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RunIdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: run, error } = await context.supabase
      .from("search_runs")
      .select("*")
      .eq("id", data.runId)
      .single();
    if (error) throw new Error(error.message);
    const rounds = (run.rounds ?? 1) + 1;
    await context.supabase.from("search_runs").update({ rounds, status: "running" }).eq("id", run.id);
    return { round: rounds };
  });

// ---------------------------------------------------------------------------
// Stage execution
// ---------------------------------------------------------------------------

const StageInput = z.object({
  runId: z.string().uuid(),
  stage: z.enum(SEARCH_STAGES),
  round: z.number().int().min(1).max(10),
});

export type StageOutcome = {
  ok: boolean;
  stage: SearchStage;
  message: string;
  added: number;
  updated: number;
  total: number;
  pending: number;
  error?: string;
  fatal?: boolean;
};

export const runSearchStage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => StageInput.parse(d))
  .handler(async ({ data, context }): Promise<StageOutcome> => {
    const S = await import("./online-search.server");
    const { data: run, error: runErr } = await context.supabase
      .from("search_runs")
      .select("*")
      .eq("id", data.runId)
      .single();
    if (runErr) throw new Error(runErr.message);

    const { data: rows, error: rowsErr } = await context.supabase
      .from("search_results")
      .select("*")
      .eq("run_id", run.id);
    if (rowsErr) throw new Error(rowsErr.message);

    const existing: OS.Candidate[] = (rows ?? []).map(rowToCandidate);
    const keyById = new Map<string, string>();
    for (const r of rows ?? []) keyById.set(r.match_key, r.id);

    const before = new Map(existing.map((c) => [c.matchKey, JSON.stringify(c)]));

    let message = "";
    let pending = 0;

    try {
      if (data.stage === "maps") {
        pending = await stageMaps(S, existing, run.niche, run.location, run.max_leads ?? 60);
        message = `Map listings checked`;
      } else if (data.stage === "verify") {
        pending = await stageVerify(S, existing);
        message = `Website checks done`;
      } else {
        const queries = S.planQueries(run.niche, run.location, data.stage, data.round);
        await stageWeb(S, existing, queries, data.stage, run.location);
        message = `${STAGE_LABELS[data.stage]} finished`;
      }
    } catch (e) {
      const err = e as Error;
      const fatal = e instanceof S.OnlineSearchError;
      await context.supabase
        .from("search_runs")
        .update({ status: "error", error_message: err.message })
        .eq("id", run.id);
      return {
        ok: false,
        stage: data.stage,
        message: "",
        added: 0,
        updated: 0,
        total: existing.length,
        pending: 0,
        error: err.message,
        fatal,
      };
    }

    // Recompute derived fields and persist.
    let added = 0;
    let updated = 0;
    for (const c of existing) {
      const { status, evidence } = S.computeWebsiteStatus(c);
      const forced = c.website_evidence.filter((e: OS.EvidenceItem) => e.note.startsWith("Checked:"));
      c.website_evidence = [...evidence.filter((e: OS.EvidenceItem) => !forced.some((f: OS.EvidenceItem) => f.url === e.url)), ...forced];
      c.website_status = c.website_status === "uncertain" && forced.length ? c.website_status : status;
      if (forced.some((f: OS.EvidenceItem) => f.note.includes("not reachable") || f.note.includes("does not mention"))) {
        c.website_status = "uncertain";
      }
      c.quality_score = S.scoreCandidate(c);

      const id = keyById.get(c.matchKey);
      const payload = candidateToRow(c, run.id, context.userId);
      if (!id) {
        const { error } = await context.supabase.from("search_results").insert(payload);
        if (!error) added++;
      } else if (before.get(c.matchKey) !== JSON.stringify(c)) {
        const { error } = await context.supabase.from("search_results").update(payload).eq("id", id);
        if (!error) updated++;
      }
    }

    const total = existing.length;
    await context.supabase
      .from("search_runs")
      .update({
        result_count: total,
        status: data.stage === "verify" ? "done" : "running",
        error_message: null,
      })
      .eq("id", run.id);

    return { ok: true, stage: data.stage, message, added, updated, total, pending };
  });

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

type ServerLib = typeof import("./online-search.server");

async function stageMaps(
  S: ServerLib,
  existing: OS.Candidate[],
  niche: string,
  location: string,
  limit: number,
): Promise<number> {
  const { getLeadSource } = await import("./lead-source.server");
  const source = getLeadSource("google_maps");
  if (!source.status().configured) return 0;
  const businesses = await source.searchBusinesses(niche, location, Math.min(limit || 40, 60));
  for (const b of businesses) {
    const sources: OS.SourceRef[] = [];
    if (b.maps_url) sources.push({ url: b.maps_url, kind: "google_page", origin: "Google Maps listing", title: b.company_name });
    if (b.website) {
      const cls = S.classifyUrl(b.website);
      sources.push({
        url: b.website,
        kind: cls.kind,
        ...(cls.platform ? { platform: cls.platform } : {}),
        origin: "Website listed on Google Maps",
      });
    }
    const socialFromWebsite: Record<string, string> = {};
    if (b.website) {
      const cls = S.classifyUrl(b.website);
      if (cls.kind === "social" && cls.platform) socialFromWebsite[cls.platform] = b.website;
    }
    const cand = S.makeCandidate({
      matchKey: `gmaps:${b.source_id}`,
      business_name: b.company_name,
      category: b.industry,
      city: b.city,
      country: b.country,
      address: b.address,
      phone: b.phone,
      website: S.classifyUrl(b.website ?? "").kind === "website" ? b.website : null,
      maps_url: b.maps_url,
      rating: b.rating,
      review_count: b.review_count,
      description: b.description,
      social_links: socialFromWebsite,
      sources,
      place_id: b.source_id,
    });
    upsertCandidate(S, existing, cand);
  }
  return 0;
}

const PHONE_RE = /(\+?\d[\d\s().-]{7,17}\d)/;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/;

async function stageWeb(
  S: ServerLib,
  existing: OS.Candidate[],
  queries: string[],
  stage: SearchStage,
  location: string,
): Promise<void> {
  for (const q of queries) {
    const results = await S.webSearch(q, 10);
    for (const r of results) {
      const cls = S.classifyUrl(r.url);
      if (cls.kind === "unknown") continue;
      const name = S.cleanBusinessName(r.title, r.url);
      if (!name) continue;
      const blob = `${r.title} ${r.description}`;
      const phone = PHONE_RE.exec(blob)?.[1]?.trim() ?? null;
      const email = EMAIL_RE.exec(blob)?.[0] ?? null;
      const social: Record<string, string> = {};
      if (cls.kind === "social" && cls.platform) social[cls.platform] = r.url;
      const mentionsLocation = blob.toLowerCase().includes(location.toLowerCase().split(",")[0]!.trim());
      const cand = S.makeCandidate({
        matchKey: `web:${S.hostOf(r.url) ?? r.url}:${S.normalizeName(name).slice(0, 24)}`,
        business_name: name,
        city: mentionsLocation ? location : null,
        phone,
        email,
        website: cls.kind === "website" ? r.url : null,
        description: r.description || null,
        social_links: social,
        sources: [
          {
            url: r.url,
            kind: cls.kind,
            ...(cls.platform ? { platform: cls.platform } : {}),
            title: r.title,
            origin: `${stage === "social" ? "Social search" : stage === "directory" ? "Directory search" : "Web search"}: ${q}`,
          },
        ],
      });
      upsertCandidate(S, existing, cand);
    }
  }
}

async function stageVerify(S: ServerLib, existing: OS.Candidate[]): Promise<number> {
  const pendingList = existing.filter(
    (c) => c.website && !c.website_evidence.some((e: OS.EvidenceItem) => e.url === c.website && e.note.startsWith("Checked:")),
  );
  const batch = pendingList.slice(0, 5);
  for (const c of batch) {
    const site = c.website!;
    const v = await S.verifyWebsite(site, c.business_name);
    const note = !v.reachable
      ? `Checked: the domain is not reachable — ${v.note}`
      : v.matches
        ? `Checked: live standalone website — ${v.note}`
        : `Checked: live page but it does not mention this business — ${v.note}`;
    c.website_evidence = [...c.website_evidence.filter((e: OS.EvidenceItem) => e.url !== site), { url: site, kind: "website", note }];
    if (!v.reachable || !v.matches) {
      c.website_status = "uncertain";
      c.website = v.reachable && v.matches ? site : null;
    } else {
      c.website_status = "website_found";
      c.website = site;
      if (!c.email) {
        try {
          const { enrichFromWebsite } = await import("./enrichment.server");
          const found = await enrichFromWebsite(site);
          if (found.email) c.email = found.email;
          for (const [p, url] of Object.entries(found.socials)) {
            if (url && !c.social_links[p]) c.social_links[p] = url;
          }
        } catch {
          /* contact details are optional */
        }
      }
    }
  }
  return Math.max(pendingList.length - batch.length, 0);
}

function upsertCandidate(S: ServerLib, existing: OS.Candidate[], cand: OS.Candidate) {
  const match = S.findMatch(existing, cand);
  if (match) S.mergeInto(match, cand);
  else existing.push(cand);
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function rowToCandidate(r: SearchResultRow): OS.Candidate {
  return {
    matchKey: r.match_key,
    business_name: r.business_name,
    category: r.category,
    city: r.city,
    country: r.country,
    address: r.address,
    phone: r.phone,
    email: r.email,
    website: r.website,
    maps_url: r.maps_url,
    rating: r.rating === null ? null : Number(r.rating),
    review_count: r.review_count,
    description: r.description,
    social_links: (r.social_links ?? {}) as Record<string, string>,
    website_status: r.website_status as OS.WebsiteStatus,
    website_evidence: (r.website_evidence ?? []) as OS.EvidenceItem[],
    sources: (r.sources ?? []) as OS.SourceRef[],
    quality_score: r.quality_score,
    place_id: r.match_key.startsWith("gmaps:") ? r.match_key.slice(6) : null,
  };
}

function candidateToRow(c: OS.Candidate, runId: string, userId: string) {
  return {
    run_id: runId,
    user_id: userId,
    match_key: c.matchKey,
    business_name: c.business_name,
    category: c.category,
    city: c.city,
    country: c.country,
    address: c.address,
    phone: c.phone,
    email: c.email,
    website: c.website,
    maps_url: c.maps_url,
    rating: c.rating,
    review_count: c.review_count,
    description: c.description,
    social_links: c.social_links,
    website_status: c.website_status,
    website_evidence: c.website_evidence,
    sources: c.sources,
    quality_score: c.quality_score,
  };
}

// ---------------------------------------------------------------------------
// Import into Leads
// ---------------------------------------------------------------------------

const ImportInput = z.object({ resultIds: z.array(z.string().uuid()).min(1).max(100) });

export const importSearchResults = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ImportInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("search_results")
      .select("*")
      .in("id", data.resultIds)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);

    let imported = 0;
    let duplicates = 0;
    const failed: string[] = [];

    for (const r of rows ?? []) {
      if (r.imported_lead_id) {
        duplicates++;
        continue;
      }
      const { data: lead, error: insErr } = await context.supabase
        .from("leads")
        .insert({
          user_id: context.userId,
          company_name: r.business_name,
          first_name: null,
          last_name: null,
          industry: r.category,
          address: r.address,
          city: r.city,
          country: r.country,
          website: r.website,
          email: r.email,
          phone: r.phone,
          maps_url: r.maps_url,
          rating: r.rating,
          review_count: r.review_count,
          description: r.description,
          source: "online_search",
          source_id: r.id,
          social_links: r.social_links,
          qualification_status: "new",
          outreach_status: "none",
        })
        .select("id")
        .single();
      if (insErr) {
        if (insErr.code === "23505") duplicates++;
        else failed.push(`${r.business_name}: ${insErr.message}`);
        continue;
      }
      imported++;
      await context.supabase.from("search_results").update({ imported_lead_id: lead.id }).eq("id", r.id);
    }
    return { imported, duplicates, failed };
  });
