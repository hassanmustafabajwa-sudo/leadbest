// LinkedIn Leads: discovers public professional profiles via legitimate
// public web search (site:linkedin.com/in ...), not private/authenticated
// LinkedIn access, scraping, or credential collection of any kind.
//
// Built on the same webSearch()/AI-provider infrastructure as Decision
// Makers. See decision-makers.server.ts for the shared anti-fabrication
// rules; this file adds LinkedIn URL validation and the richer
// LinkedIn-specific data model.

import { z } from "zod";
import { webSearch, type WebResult } from "./online-search.server";
import { runAiJson, type AiProviderId } from "./ai-provider.server";
import {
  isPersonalEmail,
  normalizeCompanyName,
  normalizePersonName,
  normalizeLinkedInProfileUrl,
} from "./people-search-shared";

// What the AI extraction step actually produces from search snippets.
export type ExtractedLead = {
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
};

// The public shape returned to the client: the extraction plus fields that
// are never inferred by the AI itself.
export type LinkedInLeadExtraction = ExtractedLead & { targetService: string | null; sourceType: string };

const LeadSchema = z.object({
  fullName: z.string().min(1).nullable(),
  jobTitle: z.string().min(1).nullable(),
  companyName: z.string().min(1).nullable(),
  location: z.string().min(1).nullable(),
  headline: z.string().min(1).nullable(),
  linkedinUrl: z.string().min(1).nullable(),
  companyUrl: z.string().min(1).nullable(),
  industry: z.string().min(1).nullable(),
  seniority: z.string().min(1).nullable(),
  professionalEmail: z.string().min(1).nullable(),
  professionalPhone: z.string().min(1).nullable(),
  companyEmail: z.string().min(1).nullable(),
  companyPhone: z.string().min(1).nullable(),
  sourceUrls: z.array(z.string()),
  evidence: z.array(z.string()),
  confidence: z.number().min(0).max(100),
});

const LeadsResponseSchema = z.object({ leads: z.array(LeadSchema).max(15) });

const nullableStr = { type: ["string", "null"] } as const;

const leadJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    fullName: nullableStr,
    jobTitle: nullableStr,
    companyName: nullableStr,
    location: nullableStr,
    headline: nullableStr,
    linkedinUrl: nullableStr,
    companyUrl: nullableStr,
    industry: nullableStr,
    seniority: nullableStr,
    professionalEmail: nullableStr,
    professionalPhone: nullableStr,
    companyEmail: nullableStr,
    companyPhone: nullableStr,
    sourceUrls: { type: "array", items: { type: "string" } },
    evidence: { type: "array", items: { type: "string" } },
    confidence: { type: "integer" },
  },
  required: [
    "fullName",
    "jobTitle",
    "companyName",
    "location",
    "headline",
    "linkedinUrl",
    "companyUrl",
    "industry",
    "seniority",
    "professionalEmail",
    "professionalPhone",
    "companyEmail",
    "companyPhone",
    "sourceUrls",
    "evidence",
    "confidence",
  ],
};

const leadsJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: { leads: { type: "array", items: leadJsonSchema, maxItems: 15 } },
  required: ["leads"],
};

// ---------------------------------------------------------------------------
// Query planning (spec section 15)
// ---------------------------------------------------------------------------

export function planLinkedInQueries(query: string, location: string, role: string): string[] {
  const q = query.trim();
  const l = location.trim();
  const roleTerm = role && role !== "Any" && role !== "Other" ? role : null;

  const parts = [roleTerm, q, l].filter(Boolean).join(" ");
  const base = [
    `site:linkedin.com/in ${parts}`,
    `site:linkedin.com/in "${q}"${l ? ` "${l}"` : ""}`,
  ];
  if (roleTerm) base.push(`site:linkedin.com/in "${roleTerm}" ${q} ${l}`.trim());
  else base.push(`site:linkedin.com/in founder ${q} ${l}`.trim(), `site:linkedin.com/in CEO ${q} ${l}`.trim());

  // De-dup identical strings, cap the number of live searches.
  return [...new Set(base)].slice(0, 6);
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

function formatSnippets(results: WebResult[]): string {
  return results.map((r, i) => `[${i}] URL: ${r.url}\nTitle: ${r.title}\nSnippet: ${r.description}`).join("\n\n");
}

async function extractLeadsFromSnippets(
  results: WebResult[],
  args: { query: string; location: string; role: string; service: string | null },
  provider: AiProviderId,
  model: string | null,
): Promise<ExtractedLead[]> {
  if (results.length === 0) return [];

  const system = `You extract public professional profile information from LinkedIn-related web search snippets (title + URL + snippet only — you do not have direct LinkedIn access).

STRICT RULES:
- Use ONLY information present in the snippets. Never invent a name, title, company, headline, email, or phone.
- Only accept a "linkedinUrl" that is a personal profile path (linkedin.com/in/...). Reject linkedin.com/company/... or any other LinkedIn URL — set linkedinUrl to null instead if only a company page is visible.
- If a field is not clearly supported by a snippet, set it to null. Do not guess.
- Only extract "professionalEmail"/"companyEmail" if actually visible in a snippet and, for professionalEmail, only if it looks like a personal mailbox (not info@/contact@/sales@/support@/admin@/office@/careers@/team@/mail@/enquiries@ etc). Never construct an email from a person's name and a company domain.
- "seniority" should be a short label like "Founder", "C-level", "Director", "Manager", or null if unclear.
- "sourceType" is always the fixed string "linkedin_public_search".
- "evidence" must be short quotes or close paraphrases from the snippets. "sourceUrls" must be exact URLs from the snippets.
- "confidence" (0-100): high (70+) when the LinkedIn profile URL itself plus the snippet text clearly agree on identity/role/company; medium (40-69) for partial agreement; low (<40) for weak signals.
- Do not return the same person twice.
- Only return people plausibly relevant to: ${args.query}${args.location ? ` in ${args.location}` : ""}.${args.role && args.role !== "Any" ? ` Prefer role: ${args.role}.` : ""}
- Return at most 15 people, best evidence first.`;

  const prompt = `Search context:\nQuery: ${args.query}\nLocation: ${args.location || "(not specified)"}\nRole filter: ${args.role || "Any"}\nTarget service (context only): ${args.service || "(none)"}\n\nSearch result snippets:\n\n${formatSnippets(results)}\n\nExtract the LinkedIn leads you can support with evidence.`;

  const res = await runAiJson<{ leads: ExtractedLead[] }>({
    task: "linkedin_lead_extraction",
    provider,
    model,
    system,
    prompt,
    schemaName: "linkedin_leads",
    schema: leadsJsonSchema,
    validate: (raw) => {
      const parsed = LeadsResponseSchema.safeParse(raw);
      if (!parsed.success) return null;
      return parsed.data;
    },
  });
  return res.data.leads.map((l) => ({ ...l, sourceType: "linkedin_public_search" }));
}

// ---------------------------------------------------------------------------
// Post-processing
// ---------------------------------------------------------------------------

export function sanitizeLead(l: ExtractedLead): ExtractedLead {
  const linkedinUrl = normalizeLinkedInProfileUrl(l.linkedinUrl);
  return {
    ...l,
    linkedinUrl,
    professionalEmail: isPersonalEmail(l.professionalEmail) ? l.professionalEmail!.trim().toLowerCase() : null,
    companyEmail: l.companyEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(l.companyEmail.trim()) ? l.companyEmail.trim().toLowerCase() : null,
    confidence: Math.max(0, Math.min(100, Math.round(l.confidence))),
  };
}

export function linkedInLeadMatchKey(l: { fullName: string | null; companyName: string | null; jobTitle: string | null; linkedinUrl: string | null }): string {
  if (l.linkedinUrl) return `li:${l.linkedinUrl}`;
  const name = l.fullName ? normalizePersonName(l.fullName) : "";
  const company = l.companyName ? normalizeCompanyName(l.companyName) : "";
  const title = l.jobTitle ? l.jobTitle.trim().toLowerCase() : "";
  return `name:${name}|${company}|${title}`;
}

export function dedupeLeads<T extends { fullName: string | null; companyName: string | null; jobTitle: string | null; linkedinUrl: string | null }>(
  leads: T[],
): T[] {
  const seen = new Map<string, T>();
  for (const l of leads) {
    if (!l.fullName) continue;
    const key = linkedInLeadMatchKey(l);
    if (!seen.has(key)) seen.set(key, l);
  }
  return [...seen.values()];
}

export async function searchLinkedInLeads(args: {
  query: string;
  location: string;
  role: string;
  service: string | null;
  provider: AiProviderId;
  model: string | null;
}): Promise<ExtractedLead[]> {
  const queries = planLinkedInQueries(args.query, args.location, args.role);
  const allResults: WebResult[] = [];
  for (const q of queries) {
    try {
      allResults.push(...(await webSearch(q, 8)));
    } catch (e) {
      console.warn(`[linkedin-leads] query failed "${q}": ${(e as Error).message}`);
    }
  }
  if (allResults.length === 0) return [];

  const seenUrls = new Set<string>();
  const uniqueResults = allResults.filter((r) => {
    if (seenUrls.has(r.url)) return false;
    seenUrls.add(r.url);
    return true;
  });

  const BATCH = 10;
  const batches: WebResult[][] = [];
  for (let i = 0; i < uniqueResults.length; i += BATCH) batches.push(uniqueResults.slice(i, i + BATCH));

  const extracted: ExtractedLead[] = [];
  for (const batch of batches) {
    try {
      const leads = await extractLeadsFromSnippets(batch, args, args.provider, args.model);
      extracted.push(...leads.map(sanitizeLead));
    } catch (e) {
      console.warn(`[linkedin-leads] extraction batch failed: ${(e as Error).message}`);
    }
  }

  const deduped = dedupeLeads(extracted).filter((l) => l.fullName);
  deduped.sort((a, b) => b.confidence - a.confidence);
  return deduped;
}

export async function enrichLinkedInLead(
  lead: ExtractedLead,
  provider: AiProviderId,
  model: string | null,
): Promise<ExtractedLead> {
  if (!lead.fullName) return lead;
  const companyPart = lead.companyName ? `"${lead.companyName}"` : "";
  const queries = [
    `"${lead.fullName}" ${companyPart} email`,
    `"${lead.fullName}" ${companyPart} contact`,
    `"${lead.fullName}" ${companyPart} phone`,
  ].map((q) => q.replace(/\s+/g, " ").trim());

  const results: WebResult[] = [];
  for (const q of queries) {
    try {
      results.push(...(await webSearch(q, 5)));
    } catch (e) {
      console.warn(`[linkedin-leads] enrich query failed "${q}": ${(e as Error).message}`);
    }
  }
  if (results.length === 0) return lead;

  const extra = await extractLeadsFromSnippets(
    results,
    { query: `${lead.fullName} ${lead.companyName ?? ""}`.trim(), location: lead.location ?? "", role: "", service: null },
    provider,
    model,
  );
  const match = dedupeLeads([lead, ...extra.map(sanitizeLead)]).find(
    (l) => linkedInLeadMatchKey(l) === linkedInLeadMatchKey(lead),
  );
  if (!match) return lead;

  const merged: ExtractedLead = {
    fullName: lead.fullName ?? match.fullName,
    jobTitle: lead.jobTitle ?? match.jobTitle,
    companyName: lead.companyName ?? match.companyName,
    location: lead.location ?? match.location,
    headline: lead.headline ?? match.headline,
    linkedinUrl: lead.linkedinUrl ?? match.linkedinUrl,
    companyUrl: lead.companyUrl ?? match.companyUrl,
    industry: lead.industry ?? match.industry,
    seniority: lead.seniority ?? match.seniority,
    professionalEmail: lead.professionalEmail ?? match.professionalEmail,
    professionalPhone: lead.professionalPhone ?? match.professionalPhone,
    companyEmail: lead.companyEmail ?? match.companyEmail,
    companyPhone: lead.companyPhone ?? match.companyPhone,
    sourceUrls: [...new Set([...lead.sourceUrls, ...match.sourceUrls])].slice(0, 10),
    evidence: [...new Set([...lead.evidence, ...match.evidence])].slice(0, 10),
    confidence: Math.max(lead.confidence, match.confidence),
  };
  return merged;
}
