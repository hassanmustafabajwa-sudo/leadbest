// Website enrichment: visits a lead's website and extracts a contact email
// and public social profile links. Only real page content is used — nothing
// is guessed or invented.

export type SocialLinks = {
  facebook?: string;
  instagram?: string;
  linkedin?: string;
  twitter?: string;
  youtube?: string;
  tiktok?: string;
};

export type EnrichmentResult = {
  email: string | null;
  socials: SocialLinks;
  contactPageUrl: string | null;
  pagesVisited: number;
};

export class EnrichmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnrichmentError";
  }
}

const UA =
  "Mozilla/5.0 (compatible; LeadGenOS/1.0; +https://lovable.dev) contact-details-lookup";

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/g;
const BAD_EMAIL_PARTS = [
  "example.com",
  "sentry.io",
  "wixpress.com",
  "domain.com",
  "yourdomain",
  "email.com",
  "godaddy",
  "squarespace.com",
  "@2x",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
];
const ROLE_PREFIXES = ["info", "contact", "hello", "hallo", "office", "sales", "kontakt", "mail", "enquiries", "inquiries", "team", "support", "admin"];

function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

async function fetchPage(url: string, timeoutMs = 10000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html") && !type.includes("text/plain")) return null;
    const text = await res.text();
    // Inline JSON blobs escape characters (\u003e, \/) which would otherwise
    // glue junk onto addresses and links.
    return text.slice(0, 600_000).replace(/\\u[0-9a-fA-F]{4}/g, " ").replace(/\\\//g, "/");
  } catch {
    return null;
  }
}

function cleanEmail(value: string): string | null {
  const email = value
    .trim()
    .replace(/^[^A-Za-z0-9]+/, "")
    .replace(/[).,;:'"]+$/, "")
    .toLowerCase();
  if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}$/.test(email)) return null;
  if (email.length > 120) return null;
  const lower = email.toLowerCase();
  if (BAD_EMAIL_PARTS.some((bad) => lower.includes(bad))) return null;
  if (/\.(png|jpe?g|gif|webp|svg|css|js)$/i.test(email)) return null;
  return email;
}

function collectEmails(html: string, siteHost: string | null): string[] {
  const found = new Set<string>();
  for (const m of html.matchAll(/mailto:([^"'?>\s]+)/gi)) {
    const e = cleanEmail(decodeURIComponent(m[1] ?? ""));
    if (e) found.add(e);
  }
  for (const m of html.matchAll(EMAIL_RE)) {
    const e = cleanEmail(m[0]);
    if (e) found.add(e);
  }
  const list = [...found];
  // Prefer addresses on the business's own domain, then common role inboxes.
  return list.sort((a, b) => score(b) - score(a));

  function score(email: string): number {
    let s = 0;
    const [local = "", domain = ""] = email.split("@");
    if (siteHost && (domain === siteHost || domain.endsWith(`.${siteHost}`) || siteHost.endsWith(`.${domain}`))) s += 10;
    if (ROLE_PREFIXES.includes(local)) s += 5;
    return s;
  }
}

const SOCIAL_MATCHERS: Array<{ key: keyof SocialLinks; test: RegExp }> = [
  { key: "facebook", test: /^https?:\/\/(www\.|m\.|web\.)?facebook\.com\/[^"'\s]+/i },
  { key: "instagram", test: /^https?:\/\/(www\.)?instagram\.com\/[^"'\s]+/i },
  { key: "linkedin", test: /^https?:\/\/([a-z]{2}\.)?(www\.)?linkedin\.com\/[^"'\s]+/i },
  { key: "twitter", test: /^https?:\/\/(www\.)?(twitter\.com|x\.com)\/[^"'\s]+/i },
  { key: "youtube", test: /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\/[^"'\s]+/i },
  { key: "tiktok", test: /^https?:\/\/(www\.)?tiktok\.com\/[^"'\s]+/i },
];

const SOCIAL_JUNK = /\/(sharer|share|intent|dialog|plugins|login|signup|home\.php|embed|watch|shorts|channel\/UC[^/]*\/videos|status)/i;

function collectSocials(html: string, into: SocialLinks) {
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const href = (m[1] ?? "").trim();
    if (!/^https?:\/\//i.test(href)) continue;
    if (SOCIAL_JUNK.test(href)) continue;
    for (const { key, test } of SOCIAL_MATCHERS) {
      if (into[key]) continue;
      if (test.test(href)) {
        const url = href.split("?")[0] ?? href;
        // Skip bare platform roots like facebook.com/
        const path = url.replace(/^https?:\/\/[^/]+\/?/, "");
        if (path.length < 2) continue;
        into[key] = url;
      }
    }
  }
}

function findContactPage(html: string, base: string): string | null {
  const candidates: Array<{ url: string; rank: number }> = [];
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const href = (m[1] ?? "").trim();
    if (!href || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("#")) continue;
    let abs: URL;
    try {
      abs = new URL(href, base);
    } catch {
      continue;
    }
    if (abs.origin !== new URL(base).origin) continue;
    const p = abs.pathname.toLowerCase();
    let rank = -1;
    if (/contact|kontakt|contacto|contatti|contato/.test(p)) rank = 3;
    else if (/impressum|legal-notice|mentions-legales/.test(p)) rank = 2;
    else if (/about|over-ons|a-propos|team/.test(p)) rank = 1;
    if (rank > 0) candidates.push({ url: abs.toString(), rank });
  }
  candidates.sort((a, b) => b.rank - a.rank);
  return candidates[0]?.url ?? null;
}

/**
 * Visits the lead's website (home page, then a contact/imprint page when one
 * is linked) and extracts a contact email plus social profile links.
 */
export async function enrichFromWebsite(website: string): Promise<EnrichmentResult> {
  const home = normalizeUrl(website);
  if (!home) throw new EnrichmentError("Website URL is not valid.");

  let host: string | null = null;
  try {
    host = new URL(home).hostname.replace(/^www\./, "");
  } catch {
    host = null;
  }

  const homeHtml = await fetchPage(home);
  if (homeHtml === null) {
    throw new EnrichmentError("Website could not be reached (no response, blocked, or not an HTML page).");
  }

  let pagesVisited = 1;
  const socials: SocialLinks = {};
  collectSocials(homeHtml, socials);
  let emails = collectEmails(homeHtml, host);

  let contactPageUrl: string | null = null;
  if (!emails.length || Object.keys(socials).length === 0) {
    contactPageUrl = findContactPage(homeHtml, home);
    if (contactPageUrl) {
      const contactHtml = await fetchPage(contactPageUrl);
      if (contactHtml) {
        pagesVisited++;
        collectSocials(contactHtml, socials);
        if (!emails.length) emails = collectEmails(contactHtml, host);
      }
    }
  }

  return {
    email: emails[0] ?? null,
    socials,
    contactPageUrl,
    pagesVisited,
  };
}
