// Decision Makers: finds real people (founders, owners, CEOs, directors...)
// behind a business, instead of generic company inboxes.
//
// Reuses the existing Firecrawl-backed webSearch() and the shared AI
// provider chain (runAiJson). Nothing here fabricates data — every field is
// either taken verbatim from a search result or extracted by the AI from
// that result's text, with the source URL kept as evidence. Fields the AI
// cannot support with evidence must come back null.

import { z } from "zod";
import { webSearch, hostOf, type WebResult } from "./online-search.server";
import { runAiJson, type AiProviderId } from "./ai-provider.server";
import { isPersonalEmail, normalizeCompanyName, normalizePersonName, normalizeLinkedInProfileUrl } from "./people-search-shared";

export type DecisionMakerRoleFilter = string; // one of DECISION_MAKER_ROLES, or "" for any

// What the AI extraction step actually produces from search snippets.
export type ExtractedPerson = {
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
};

// The public shape returned to the client: the extraction plus the
// user-selected target service, which is never inferred by the AI.
export type PersonExtraction = ExtractedPerson & { targetService: string | null };

const PersonExtractionSchema = z.object({
  fullName: z.string().min(1).nullable(),
  jobTitle: z.string().min(1).nullable(),
  companyName: z.string().min(1).nullable(),
  location: z.string().min(1).nullable(),
  linkedinUrl: z.string().min(1).nullable(),
  professionalEmail: z.string().min(1).nullable(),
  professionalPhone: z.string().min(1).nullable(),
  companyWebsite: z.string().min(1).nullable(),
  evidence: z.array(z.string()),
  sourceUrls: z.array(z.string()),
  confidence: z.number().min(0).max(100),
});

const PeopleExtractionResponseSchema = z.object({
  people: z.array(PersonExtractionSchema).max(15),
});

const nullableStr = { type: ["string", "null"] } as const;

const personJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    fullName: nullableStr,
    jobTitle: nullableStr,
    companyName: nullableStr,
    location: nullableStr,
    linkedinUrl: nullableStr,
    professionalEmail: nullableStr,
    professionalPhone: nullableStr,
    companyWebsite: nullableStr,
    evidence: { type: "array", items: { type: "string" } },
    sourceUrls: { type: "array", items: { type: "string" } },
    confidence: { type: "integer", description: "0-100 confidence this is a real, correctly identified decision maker" },
  },
  required: [
    "fullName",
    "jobTitle",
    "companyName",
    "location",
    "linkedinUrl",
    "professionalEmail",
    "professionalPhone",
    "companyWebsite",
    "evidence",
    "sourceUrls",
    "confidence",
  ],
};

const peopleJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    people: { type: "array", items: personJsonSchema, maxItems: 15 },
  },
  required: ["people"],
};

// ---------------------------------------------------------------------------
// Query planning (spec section 5)
// ---------------------------------------------------------------------------

export function planDecisionMakerQueries(query: string, location: string, role: string): string[] {
  const q = query.trim();
  const l = location.trim();
  const roleTerm = role && role !== "Any" && role !== "Other" ? role.toLowerCase() : null;

  const base = [
    `${q} founder`,
    `${q} owner`,
    `${q} CEO`,
    `${q} managing director`,
    `${q} director`,
    `${q} leadership team`,
    `${q} about founder`,
  ];
  if (roleTerm) base.unshift(`${q} ${roleTerm}`);
  if (l) base.push(`${q} ${l} founder`, `${q} ${l} owner`);

  const linkedin = roleTerm
    ? [`site:linkedin.com/in ${q} ${roleTerm}`]
    : [`site:linkedin.com/in ${q} founder`, `site:linkedin.com/in ${q} CEO`];

  // Cap the number of live searches per request: quality over volume.
  return [...base, ...linkedin].slice(0, 8);
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

function formatSnippets(results: WebResult[]): string {
  return results
    .map((r, i) => `[${i}] URL: ${r.url}\nTitle: ${r.title}\nSnippet: ${r.description}`)
    .join("\n\n");
}

async function extractPeopleFromSnippets(
  results: WebResult[],
  args: { query: string; location: string; role: string; service: string | null },
  provider: AiProviderId,
  model: string | null,
): Promise<ExtractedPerson[]> {
  if (results.length === 0) return [];

  const system = `You identify real business decision makers (founders, owners, CEOs, directors, partners, marketing/sales leadership) from public web search snippets.

STRICT RULES:
- Use ONLY information present in the snippets provided. Never invent a name, title, company, email, phone, or LinkedIn URL.
- If a fact is not clearly supported by the snippets, set that field to null. Do not guess.
- Only extract a personal LinkedIn profile URL (linkedin.com/in/...), never a company page.
- Only extract "professionalEmail" if it looks like a personal mailbox (a real name, not a generic inbox like info@, contact@, sales@, support@, admin@, office@, careers@, team@, mail@, enquiries@). If only a generic company email is visible, leave professionalEmail null.
- Never construct an email address yourself (e.g. do not guess firstname@company.com just because you know the person's name and the company's domain).
- "evidence" must be short quotes or close paraphrases from the snippets that justify why this person is a decision maker (e.g. "About page identifies as Founder"). "sourceUrls" must be the exact URLs (copied from the snippets) that support this person's record.
- "confidence" (0-100): high (70+) only when multiple snippets or a clear authoritative source (About/Team page, LinkedIn) agree on identity, company, and role. Medium (40-69) when the role and company are supported but some detail is thin. Low (<40) for weak or single-source signals.
- Do not return the same person twice.
- Only return people who are plausibly decision makers relevant to: ${args.query}${args.location ? ` in ${args.location}` : ""}.${args.role && args.role !== "Any" ? ` Prefer role: ${args.role}.` : ""}
- Return at most 15 people, best evidence first.`;

  const prompt = `Search context:\nQuery: ${args.query}\nLocation: ${args.location || "(not specified)"}\nRole filter: ${args.role || "Any"}\nTarget service (for context only, do not invent an opportunity): ${args.service || "(none)"}\n\nSearch result snippets:\n\n${formatSnippets(results)}\n\nExtract the decision makers you can support with evidence from these snippets.`;

  const res = await runAiJson<{ people: ExtractedPerson[] }>({
    task: "decision_maker_extraction",
    provider,
    model,
    system,
    prompt,
    schemaName: "decision_makers",
    schema: peopleJsonSchema,
    validate: (raw) => {
      const parsed = PeopleExtractionResponseSchema.safeParse(raw);
      if (!parsed.success) return null;
      return parsed.data;
    },
  });
  return res.data.people;
}

// ---------------------------------------------------------------------------
// Post-processing: email quality guard + dedup + confidence label
// ---------------------------------------------------------------------------

export function sanitizePerson(p: ExtractedPerson): ExtractedPerson {
  return {
    ...p,
    professionalEmail: isPersonalEmail(p.professionalEmail) ? p.professionalEmail!.trim().toLowerCase() : null,
    linkedinUrl: normalizeLinkedInProfileUrl(p.linkedinUrl),
    confidence: Math.max(0, Math.min(100, Math.round(p.confidence))),
  };
}

export function decisionMakerMatchKey(p: { fullName: string | null; companyName: string | null; jobTitle: string | null }): string {
  if (!p.fullName) return `unknown:${Math.random()}`;
  const name = normalizePersonName(p.fullName);
  const company = p.companyName ? normalizeCompanyName(p.companyName) : "";
  return `${name}|${company}`;
}

export function dedupePeople<T extends { fullName: string | null; companyName: string | null; jobTitle: string | null; linkedinUrl: string | null }>(
  people: T[],
): T[] {
  const seen = new Map<string, T>();
  for (const p of people) {
    if (!p.fullName) continue;
    const key = p.linkedinUrl ? `li:${p.linkedinUrl}` : `name:${decisionMakerMatchKey(p)}`;
    if (!seen.has(key)) seen.set(key, p);
  }
  return [...seen.values()];
}

/**
 * Runs the full Decision Makers search: plans queries, searches the live
 * web, and asks the AI to extract verifiable people from the results.
 */
export async function searchDecisionMakers(args: {
  query: string;
  location: string;
  role: string;
  service: string | null;
  provider: AiProviderId;
  model: string | null;
}): Promise<ExtractedPerson[]> {
  const queries = planDecisionMakerQueries(args.query, args.location, args.role);
  const allResults: WebResult[] = [];
  for (const q of queries) {
    try {
      const results = await webSearch(q, 6);
      allResults.push(...results);
    } catch (e) {
      // One failed query should not sink the whole search; surface later if ALL fail.
      console.warn(`[decision-makers] query failed "${q}": ${(e as Error).message}`);
    }
  }
  if (allResults.length === 0) return [];

  // De-duplicate raw search results by URL before spending AI tokens on them.
  const seenUrls = new Set<string>();
  const uniqueResults = allResults.filter((r) => {
    if (seenUrls.has(r.url)) return false;
    seenUrls.add(r.url);
    return true;
  });

  // Batch snippets to keep prompts a reasonable size.
  const BATCH = 10;
  const batches: WebResult[][] = [];
  for (let i = 0; i < uniqueResults.length; i += BATCH) batches.push(uniqueResults.slice(i, i + BATCH));

  const extracted: ExtractedPerson[] = [];
  for (const batch of batches) {
    try {
      const people = await extractPeopleFromSnippets(batch, args, args.provider, args.model);
      extracted.push(...people.map(sanitizePerson));
    } catch (e) {
      console.warn(`[decision-makers] extraction batch failed: ${(e as Error).message}`);
    }
  }

  const deduped = dedupePeople(extracted).filter((p) => p.fullName);
  deduped.sort((a, b) => b.confidence - a.confidence);
  return deduped;
}

/**
 * Contact enrichment for a single already-found person: runs a few
 * additional targeted public searches and re-extracts, merging any new
 * verified fields into the existing record without overwriting good data
 * with worse data.
 */
export async function enrichPerson(
  person: ExtractedPerson,
  provider: AiProviderId,
  model: string | null,
): Promise<ExtractedPerson> {
  if (!person.fullName || !person.companyName) return person;
  const queries = [
    `"${person.fullName}" "${person.companyName}" email`,
    `"${person.fullName}" "${person.companyName}" contact`,
    `"${person.fullName}" "${person.companyName}" LinkedIn`,
  ];
  const results: WebResult[] = [];
  for (const q of queries) {
    try {
      results.push(...(await webSearch(q, 5)));
    } catch (e) {
      console.warn(`[decision-makers] enrich query failed "${q}": ${(e as Error).message}`);
    }
  }
  if (results.length === 0) return person;

  const extra = await extractPeopleFromSnippets(
    results,
    { query: `${person.fullName} ${person.companyName}`, location: person.location ?? "", role: "", service: null },
    provider,
    model,
  );
  const match = dedupePeople([person, ...extra.map(sanitizePerson)]).find(
    (p) => p.linkedinUrl === person.linkedinUrl || decisionMakerMatchKey(p) === decisionMakerMatchKey(person),
  );
  if (!match) return person;

  // Merge: prefer existing non-null values, fill gaps from the new pass, keep
  // the union of evidence/sources, and take the higher confidence.
  const merged: ExtractedPerson = {
    fullName: person.fullName ?? match.fullName,
    jobTitle: person.jobTitle ?? match.jobTitle,
    companyName: person.companyName ?? match.companyName,
    location: person.location ?? match.location,
    linkedinUrl: person.linkedinUrl ?? match.linkedinUrl,
    professionalEmail: person.professionalEmail ?? match.professionalEmail,
    professionalPhone: person.professionalPhone ?? match.professionalPhone,
    companyWebsite: person.companyWebsite ?? match.companyWebsite,
    evidence: [...new Set([...person.evidence, ...match.evidence])].slice(0, 10),
    sourceUrls: [...new Set([...person.sourceUrls, ...match.sourceUrls])].slice(0, 10),
    confidence: Math.max(person.confidence, match.confidence),
  };
  return merged;
}

export { hostOf };
