// Shared vocabulary + helpers for the Decision Makers and LinkedIn Leads
// features. Kept separate from lead-analysis.server.ts (which governs the
// existing Leads AI-qualification flow) so neither feature can break the
// other's schema.

export const DECISION_MAKER_ROLES = [
  "Founder",
  "Co-Founder",
  "Owner",
  "CEO",
  "Managing Director",
  "Director",
  "Partner",
  "CMO",
  "Marketing Director",
  "Head of Marketing",
  "Head of Sales",
  "General Manager",
  "Business Development Director",
  "Other",
] as const;
export type DecisionMakerRole = (typeof DECISION_MAKER_ROLES)[number];

// Existing agency services (see lead-analysis.server.ts SERVICES) extended
// with the additional service types called for by these two features.
export const TARGET_SERVICES = [
  "Website Development",
  "Website Redesign",
  "Meta Ads",
  "Google Ads",
  "TikTok Ads",
  "YouTube Ads",
  "SEO",
  "Social Media",
  "Amazon PPC/FBA",
  "Website + Ads",
  "Other",
] as const;
export type TargetService = (typeof TARGET_SERVICES)[number];

export type Confidence = "high" | "medium" | "low";

/** Turns a 0-100 numeric confidence into the transparent high/medium/low label. */
export function confidenceLabel(score: number): Confidence {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// Generic-inbox rejection
// ---------------------------------------------------------------------------

const GENERIC_LOCAL_PARTS = new Set([
  "info",
  "hello",
  "contact",
  "sales",
  "support",
  "admin",
  "office",
  "careers",
  "jobs",
  "team",
  "mail",
  "enquiries",
  "inquiries",
  "hi",
  "help",
  "marketing",
  "hr",
  "billing",
  "accounts",
  "press",
  "media",
  "webmaster",
  "noreply",
  "no-reply",
]);

/**
 * Returns true if the address is a personal-looking mailbox rather than a
 * generic company inbox. Does NOT verify the address is real — callers must
 * still have evidence tying it to the specific person.
 */
export function isPersonalEmail(email: string | null | undefined): email is string {
  if (!email) return false;
  const trimmed = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return false;
  const local = trimmed.split("@")[0]!;
  if (GENERIC_LOCAL_PARTS.has(local)) return false;
  // "info.newyork@", "sales-uk@" style variants
  const firstToken = local.split(/[._-]/)[0]!;
  if (GENERIC_LOCAL_PARTS.has(firstToken)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// LinkedIn URL validation
// ---------------------------------------------------------------------------

/**
 * Normalizes and validates a LinkedIn *personal profile* URL
 * (linkedin.com/in/...). Company, school, and other LinkedIn URLs are
 * rejected. Returns null if the URL is not a usable personal profile link.
 */
export function normalizeLinkedInProfileUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return null;
  const path = url.pathname.replace(/\/+$/, "");
  const match = /^\/in\/([a-zA-Z0-9\-_%.]+)/.exec(path);
  if (!match) return null;
  return `https://www.linkedin.com/in/${match[1]}`;
}

export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(the|ltd|limited|llc|inc|co|company|gmbh|bv|pvt|private)\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

export function normalizePersonName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
