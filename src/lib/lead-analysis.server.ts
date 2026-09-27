import { z } from "zod";
import { runAiJson, type AiProviderId, type AiRunResult } from "./ai-provider.server";

export type LeadRecord = {
  id: string;
  company_name: string;
  first_name: string | null;
  last_name: string | null;
  industry: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  maps_url: string | null;
  rating: number | null;
  review_count: number | null;
  description: string | null;
  ai_analysis?: unknown;
  recommended_service?: string | null;
};

export const SERVICES = [
  "Website Development",
  "Website Redesign",
  "SEO",
  "Social Media Marketing",
  "Paid Advertising",
  "Ecommerce",
  "Content Marketing",
  "None",
] as const;

export const LeadAnalysisSchema = z.object({
  score: z.number().int().min(0).max(100),
  qualification: z.enum(["high", "medium", "low", "unqualified"]),
  recommended_service: z.enum(SERVICES),
  reason: z.string().min(1),
  website_quality: z.enum(["good", "average", "poor", "none", "unknown"]),
  social_presence: z.enum(["strong", "weak", "none", "unknown"]),
  opportunities: z.array(z.string()),
  missing_information: z.array(z.string()),
});
export type LeadAnalysis = z.infer<typeof LeadAnalysisSchema>;

const analysisJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    score: { type: "integer", description: "0-100 likelihood this business is a good agency prospect" },
    qualification: { type: "string", enum: ["high", "medium", "low", "unqualified"] },
    recommended_service: { type: "string", enum: [...SERVICES] },
    reason: { type: "string", description: "2-4 sentence explanation grounded only in the provided data" },
    website_quality: { type: "string", enum: ["good", "average", "poor", "none", "unknown"] },
    social_presence: { type: "string", enum: ["strong", "weak", "none", "unknown"] },
    opportunities: { type: "array", items: { type: "string" } },
    missing_information: { type: "array", items: { type: "string" } },
  },
  required: [
    "score",
    "qualification",
    "recommended_service",
    "reason",
    "website_quality",
    "social_presence",
    "opportunities",
    "missing_information",
  ],
};

export function leadFacts(lead: LeadRecord): string {
  const f = (label: string, v: unknown) =>
    `${label}: ${v === null || v === undefined || v === "" ? "(not available)" : String(v)}`;
  return [
    f("Business name", lead.company_name),
    f("Contact first name", lead.first_name),
    f("Contact last name", lead.last_name),
    f("Industry / category", lead.industry),
    f("Address", lead.address),
    f("City", lead.city),
    f("Country", lead.country),
    f("Website", lead.website),
    f("Email", lead.email),
    f("Phone", lead.phone),
    f("Google Maps URL", lead.maps_url),
    f("Google rating", lead.rating),
    f("Review count", lead.review_count),
    f("Description", lead.description),
  ].join("\n");
}

export async function analyzeLeadWithAi(
  lead: LeadRecord,
  provider: AiProviderId,
  model: string | null,
): Promise<AiRunResult<LeadAnalysis>> {
  const system = `You are a lead-qualification analyst for a digital marketing agency that sells: website development, website redesign, SEO, social media marketing, paid advertising, ecommerce, and content marketing.
Rules:
- Use ONLY the facts provided. Never invent details about the business.
- You cannot browse the web. If the website URL is present you may reason about what a domain/website presence implies, but mark website_quality "unknown" unless the data itself indicates quality. If no website is listed, website_quality must be "none".
- Social presence cannot be observed from this data unless a description mentions it; default to "unknown".
- If information is missing, list it in missing_information instead of guessing.
- A business with no website is usually a strong Website Development opportunity. Many reviews plus no website suggests an established business worth contacting.
- Keep the reason concise (2-4 sentences) and specific to the facts.`;

  const prompt = `Analyze this business lead and return the structured assessment.\n\n${leadFacts(lead)}`;

  return runAiJson<LeadAnalysis>({
    task: "lead_analysis",
    provider,
    model,
    system,
    prompt,
    schemaName: "lead_analysis",
    schema: analysisJsonSchema,
    validate: (raw) => {
      const parsed = LeadAnalysisSchema.safeParse(raw);
      if (!parsed.success) {
        const i = parsed.error.issues[0];
        throw new Error(`${i?.path.join(".")} ${i?.message}`);
      }
      return parsed.data;
    },
  });
}

export const PersonalizedEmailSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
});

const personalizedJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    subject: { type: "string" },
    body: { type: "string", description: "Plain-text email body" },
  },
  required: ["subject", "body"],
};

export async function personalizeEmailWithAi(
  lead: LeadRecord,
  baseSubject: string,
  baseBody: string,
  provider: AiProviderId,
  model: string | null,
): Promise<{ subject: string; body: string }> {
  const analysis = lead.ai_analysis ? JSON.stringify(lead.ai_analysis) : "(not analyzed yet)";
  const system = `You personalize cold outreach emails for a digital marketing agency.
Rules:
- Keep the sender's intent, tone, structure, and length close to the base email. Do not add new offers or claims.
- Personalize ONLY with facts present in the lead record and AI analysis below. Never invent facts about the business (no assumptions about their team, revenue, customers, social accounts, or website content).
- If the contact first name is unavailable, open with a neutral greeting like "Hi there,".
- Do not include placeholders like {{...}} in the output; every variable must be resolved or removed.
- Plain text only. No markdown. No signature beyond what the base email contains.`;

  const prompt = `Base subject:\n${baseSubject}\n\nBase email:\n${baseBody}\n\nLead record:\n${leadFacts(lead)}\n\nRecommended service: ${lead.recommended_service ?? "(none)"}\nAI analysis JSON: ${analysis}\n\nReturn the personalized subject and body.`;

  const res = await runAiJson<{ subject: string; body: string }>({
    task: "email_personalization",
    provider,
    model,
    system,
    prompt,
    schemaName: "personalized_email",
    schema: personalizedJsonSchema,
    validate: (raw) => {
      const parsed = PersonalizedEmailSchema.safeParse(raw);
      if (!parsed.success) throw new Error("missing subject or body");
      if (/\{\{.*?\}\}/.test(parsed.data.subject + parsed.data.body)) {
        throw new Error("unresolved template variables in the email");
      }
      return parsed.data;
    },
  });
  return res.data;
}
