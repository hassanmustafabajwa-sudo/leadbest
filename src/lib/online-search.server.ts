// Online lead research: discovers real businesses across web search,
// directories, map listings and public social profiles, and works out whether
// each one has a standalone website of its own.
//
// Nothing here invents data: every field on a candidate carries the source URL
// it was read from.

export type UrlKind = "website" | "social" | "directory" | "booking" | "link_page" | "google_page" | "unknown";

export type WebsiteStatus = "no_website" | "social_only" | "directory_only" | "website_found" | "uncertain";

export type SourceRef = {
  url: string;
  kind: UrlKind;
  platform?: string;
  title?: string;
  origin: string; // which research step found it
};

export type EvidenceItem = {
  url: string;
  kind: UrlKind;
  note: string;
};

export type SocialLinkMap = Record<string, string>;

export type Candidate = {
  matchKey: string;
  business_name: string;
  category: string | null;
  city: string | null;
  country: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  maps_url: string | null;
  rating: number | null;
  review_count: number | null;
  description: string | null;
  social_links: SocialLinkMap;
  website_status: WebsiteStatus;
  website_evidence: EvidenceItem[];
  sources: SourceRef[];
  quality_score: number;
  place_id: string | null;
};

export class OnlineSearchError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "OnlineSearchError";
  }
}

// ---------------------------------------------------------------------------
// URL classification
// ---------------------------------------------------------------------------

const SOCIAL_HOSTS: Record<string, string> = {
  "instagram.com": "instagram",
  "facebook.com": "facebook",
  "fb.com": "facebook",
  "m.facebook.com": "facebook",
  "linkedin.com": "linkedin",
  "tiktok.com": "tiktok",
  "twitter.com": "twitter",
  "x.com": "twitter",
  "youtube.com": "youtube",
  "youtu.be": "youtube",
  "pinterest.com": "pinterest",
  "threads.net": "threads",
  "snapchat.com": "snapchat",
};

const LINK_PAGE_HOSTS = [
  "linktr.ee",
  "beacons.ai",
  "bio.link",
  "carrd.co",
  "msha.ke",
  "milkshake.app",
  "campsite.bio",
  "taplink.cc",
  "solo.to",
  "allmylinks.com",
  "lnk.bio",
  "flowcode.com",
];

const DIRECTORY_HOSTS = [
  "yelp.com",
  "yellowpages.com",
  "yell.com",
  "tripadvisor.com",
  "trustpilot.com",
  "bbb.org",
  "manta.com",
  "foursquare.com",
  "justdial.com",
  "indiamart.com",
  "thomsonlocal.com",
  "cylex",
  "hotfrog.com",
  "brownbook.net",
  "chamberofcommerce.com",
  "mapquest.com",
  "bing.com",
  "apple.com",
  "amazon.com",
  "etsy.com",
  "ebay.com",
  "alibaba.com",
  "angi.com",
  "houzz.com",
  "thumbtack.com",
  "checkatrade.com",
  "nextdoor.com",
  "glassdoor.com",
  "indeed.com",
  "crunchbase.com",
  "zaubacorp.com",
  "wikipedia.org",
  "reddit.com",
  "medium.com",
  "quora.com",
  "groupon.com",
  "eventbrite.com",
];

const BOOKING_HOSTS = [
  "booksy.com",
  "fresha.com",
  "treatwell",
  "styleseat.com",
  "vagaro.com",
  "square.site",
  "squareup.com",
  "calendly.com",
  "opentable.com",
  "resy.com",
  "doordash.com",
  "ubereats.com",
  "grubhub.com",
  "deliveroo",
  "justeat",
  "swiggy.com",
  "zomato.com",
  "wolt.com",
  "setmore.com",
  "acuityscheduling.com",
  "shopify.com",
  "wixsite.com",
  "weebly.com",
  "blogspot.com",
  "wordpress.com",
  "webs.com",
  "godaddysites.com",
];

const GOOGLE_HOSTS = ["business.site", "sites.google.com", "g.page", "goo.gl", "maps.google.com", "google.com"];

export function hostOf(url: string): string | null {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function hostMatches(host: string, list: string[]): string | null {
  return list.find((h) => host === h || host.endsWith(`.${h}`) || host.includes(h)) ?? null;
}

export function classifyUrl(url: string): { kind: UrlKind; platform?: string; note: string } {
  const host = hostOf(url);
  if (!host) return { kind: "unknown", note: "Not a usable web address" };

  for (const [h, platform] of Object.entries(SOCIAL_HOSTS)) {
    if (host === h || host.endsWith(`.${h}`)) {
      return { kind: "social", platform, note: `${platform} profile or page, not a standalone website` };
    }
  }
  if (hostMatches(host, GOOGLE_HOSTS)) {
    return { kind: "google_page", note: "Google-hosted page, not a standalone website" };
  }
  const linkHost = hostMatches(host, LINK_PAGE_HOSTS);
  if (linkHost) return { kind: "link_page", note: `Link-in-bio page on ${linkHost}, not a standalone website` };
  const dirHost = hostMatches(host, DIRECTORY_HOSTS);
  if (dirHost) return { kind: "directory", note: `Directory or marketplace listing on ${dirHost}` };
  const bookHost = hostMatches(host, BOOKING_HOSTS);
  if (bookHost) return { kind: "booking", note: `Booking or hosted-profile platform page on ${bookHost}` };

  return { kind: "website", note: `Standalone domain ${host}` };
}

// ---------------------------------------------------------------------------
// Firecrawl web search (through the Lovable connector gateway)
// ---------------------------------------------------------------------------

const FIRECRAWL_GATEWAY = "https://connector-gateway.lovable.dev/firecrawl/v2";

export function firecrawlStatus(): { configured: boolean; detail: string } {
  const configured = !!process.env["LOVABLE_API_KEY"] && !!process.env["FIRECRAWL_API_KEY"];
  return {
    configured,
    detail: configured
      ? "Live internet research is connected through the Firecrawl connector."
      : "Firecrawl is not connected. Link it under Connectors to enable live internet research.",
  };
}

export type WebResult = { url: string; title: string; description: string };

export async function webSearch(query: string, limit: number): Promise<WebResult[]> {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const fcKey = process.env["FIRECRAWL_API_KEY"];
  if (!lovableKey || !fcKey) {
    throw new OnlineSearchError("Internet research is not configured: the Firecrawl connector is not linked.");
  }
  const res = await fetch(`${FIRECRAWL_GATEWAY}/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": fcKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, limit: Math.min(Math.max(limit, 1), 20) }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`[online-search] Firecrawl search failed [${res.status}]: ${text.slice(0, 400)}`);
    if (res.status === 402 || (res.status === 403 && text.includes("Credit limit reached"))) {
      throw new OnlineSearchError("Internet research is out of credits for this workspace.", res.status);
    }
    if (res.status === 401 || res.status === 403) {
      throw new OnlineSearchError("Internet research authentication failed. Reconnect the Firecrawl connector.", res.status);
    }
    if (res.status === 429) {
      throw new OnlineSearchError("Internet research rate limit reached. Try again in a moment.", 429);
    }
    throw new OnlineSearchError(`Internet research failed [${res.status}]: ${text.slice(0, 300)}`, res.status);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new OnlineSearchError("Internet research returned an unreadable response.");
  }
  const body = parsed as { data?: unknown; web?: unknown };
  const raw =
    (Array.isArray(body.data) ? body.data : undefined) ??
    (Array.isArray((body.data as { web?: unknown } | undefined)?.web) ? ((body.data as { web: unknown[] }).web) : undefined) ??
    (Array.isArray(body.web) ? body.web : []);
  const out: WebResult[] = [];
  for (const r of raw as Array<Record<string, unknown>>) {
    const url = typeof r["url"] === "string" ? r["url"] : null;
    if (!url) continue;
    out.push({
      url,
      title: typeof r["title"] === "string" ? r["title"] : "",
      description: typeof r["description"] === "string" ? r["description"] : "",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Query planning
// ---------------------------------------------------------------------------

export function planQueries(niche: string, location: string, stage: "web" | "social" | "directory", round: number) {
  const n = niche.trim();
  const l = location.trim();
  if (stage === "web") {
    const base = [
      `${n} in ${l}`,
      `${n} ${l} contact phone`,
      `small ${n} business ${l}`,
    ];
    const extra = [`best ${n} ${l}`, `${n} near ${l} reviews`, `independent ${n} ${l}`];
    return round <= 1 ? base : [...base, ...extra].slice(round * 2 - 2, round * 2 + 2);
  }
  if (stage === "social") {
    const base = [
      `site:instagram.com ${n} ${l}`,
      `site:facebook.com ${n} ${l}`,
      `site:tiktok.com ${n} ${l}`,
    ];
    const extra = [`site:linkedin.com/company ${n} ${l}`, `site:instagram.com ${n} ${l} booking dm`, `site:facebook.com ${n} ${l} page`];
    return round <= 1 ? base : extra;
  }
  const base = [`${n} ${l} yelp`, `${n} ${l} directory listing`];
  const extra = [`${n} ${l} yellowpages`, `${n} ${l} business listing phone`];
  return round <= 1 ? base : extra;
}

// ---------------------------------------------------------------------------
// Name handling
// ---------------------------------------------------------------------------

const TITLE_NOISE =
  /\s*[|\-–—•·]\s*(yelp|facebook|instagram|tiktok|linkedin|twitter|x|youtube|home|official site|official website|contact( us)?|about( us)?)\b.*$/i;

export function cleanBusinessName(title: string, url: string): string | null {
  let name = (title || "").trim();
  if (!name) return null;
  // "Name (@handle) • Instagram photos and videos"
  name = name.replace(/\s*\(@[^)]+\).*$/i, "");
  name = name.replace(/\s*[|\-–—•·]\s*(instagram|facebook|tiktok|linkedin|x \(twitter\)|twitter|youtube)\b.*$/i, "");
  name = name.replace(TITLE_NOISE, "");
  name = name.replace(/\s*[|\-–—]\s*[^|\-–—]{0,40}$/, (m) => (name.length - m.length >= 3 ? "" : m));
  name = name.replace(/["“”']/g, "").trim();
  name = name.replace(/^\d+\.\s*/, "");
  if (name.length < 2 || name.length > 90) {
    const host = hostOf(url);
    return host ? host.split(".")[0] ?? null : null;
  }
  // Reject list-style page titles ("Top 10 dentists in Austin")
  if (/^(top|best|the \d+|\d+\s+best)\b/i.test(name)) return null;
  return name;
}

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(the|ltd|limited|llc|inc|co|company|gmbh|bv|pvt|private)\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

export function normalizePhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-10) : null;
}

// ---------------------------------------------------------------------------
// Merge + status + score
// ---------------------------------------------------------------------------

export function makeCandidate(partial: Partial<Candidate> & { business_name: string; matchKey: string }): Candidate {
  return {
    category: null,
    city: null,
    country: null,
    address: null,
    phone: null,
    email: null,
    website: null,
    maps_url: null,
    rating: null,
    review_count: null,
    description: null,
    social_links: {},
    website_status: "uncertain",
    website_evidence: [],
    sources: [],
    quality_score: 0,
    place_id: null,
    ...partial,
  };
}

export function findMatch(existing: Candidate[], c: Candidate): Candidate | null {
  const cPhone = normalizePhone(c.phone);
  const cDomain = c.website ? hostOf(c.website) : null;
  const cName = normalizeName(c.business_name);
  for (const e of existing) {
    if (c.place_id && e.place_id && c.place_id === e.place_id) return e;
    const eDomain = e.website ? hostOf(e.website) : null;
    if (cDomain && eDomain && cDomain === eDomain) return e;
    const ePhone = normalizePhone(e.phone);
    if (cPhone && ePhone && cPhone === ePhone) return e;
    for (const [p, url] of Object.entries(c.social_links)) {
      if (e.social_links[p] && e.social_links[p] === url) return e;
    }
    const eName = normalizeName(e.business_name);
    if (cName && eName && cName.length > 4 && (cName === eName || cName.includes(eName) || eName.includes(cName))) {
      const sameCity = !c.city || !e.city || c.city.toLowerCase() === e.city.toLowerCase();
      if (sameCity) return e;
    }
  }
  return null;
}

export function mergeInto(target: Candidate, incoming: Candidate): Candidate {
  const keep = <T,>(a: T | null, b: T | null): T | null => (a !== null && a !== undefined && a !== "" ? a : b);
  target.business_name = target.business_name.length >= incoming.business_name.length ? target.business_name : incoming.business_name;
  target.category = keep(target.category, incoming.category);
  target.city = keep(target.city, incoming.city);
  target.country = keep(target.country, incoming.country);
  target.address = keep(target.address, incoming.address);
  target.phone = keep(target.phone, incoming.phone);
  target.email = keep(target.email, incoming.email);
  target.website = keep(target.website, incoming.website);
  target.maps_url = keep(target.maps_url, incoming.maps_url);
  target.rating = keep(target.rating, incoming.rating);
  target.review_count = keep(target.review_count, incoming.review_count);
  target.description = keep(target.description, incoming.description);
  target.place_id = keep(target.place_id, incoming.place_id);
  target.social_links = { ...incoming.social_links, ...target.social_links };
  const seen = new Set(target.sources.map((s) => s.url));
  for (const s of incoming.sources) {
    if (!seen.has(s.url)) {
      seen.add(s.url);
      target.sources.push(s);
    }
  }
  return target;
}

export function computeWebsiteStatus(c: Candidate): { status: WebsiteStatus; evidence: EvidenceItem[] } {
  const evidence: EvidenceItem[] = [];
  const kinds = new Set<UrlKind>();
  for (const s of c.sources) {
    kinds.add(s.kind);
    evidence.push({ url: s.url, kind: s.kind, note: classifyUrl(s.url).note });
  }
  if (c.website) {
    const cls = classifyUrl(c.website);
    if (cls.kind === "website") {
      kinds.add("website");
      if (!evidence.some((e) => e.url === c.website)) {
        evidence.push({ url: c.website, kind: "website", note: cls.note });
      }
    }
  }
  let status: WebsiteStatus;
  if (kinds.has("website")) status = "website_found";
  else if (kinds.has("social")) status = "social_only";
  else if (kinds.has("directory") || kinds.has("booking") || kinds.has("link_page") || kinds.has("google_page")) {
    status = "directory_only";
  } else if (c.maps_url || c.phone) status = "no_website";
  else status = "uncertain";
  return { status, evidence };
}

export function scoreCandidate(c: Candidate): number {
  let score = 0;
  // Prospect value: no standalone website is what we are looking for.
  if (c.website_status === "no_website") score += 50;
  else if (c.website_status === "social_only") score += 45;
  else if (c.website_status === "directory_only") score += 35;
  else if (c.website_status === "uncertain") score += 15;
  // Signs of an active, legitimate business.
  const socials = Object.keys(c.social_links).length;
  score += Math.min(socials * 6, 18);
  if (c.phone) score += 10;
  if (c.email) score += 6;
  if (c.maps_url) score += 5;
  if ((c.review_count ?? 0) >= 5) score += 6;
  if ((c.rating ?? 0) >= 4) score += 3;
  if (c.address) score += 3;
  if (c.sources.length >= 2) score += 4;
  return Math.min(score, 100);
}

// ---------------------------------------------------------------------------
// Website verification
// ---------------------------------------------------------------------------

const UA = "Mozilla/5.0 (compatible; LeadGenOS/1.0; +https://lovable.dev) business-website-check";

export async function verifyWebsite(
  url: string,
  businessName: string,
): Promise<{ reachable: boolean; matches: boolean; note: string }> {
  const target = url.startsWith("http") ? url : `https://${url}`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(target, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    });
    clearTimeout(t);
    if (!res.ok) {
      return { reachable: false, matches: false, note: `Site responded ${res.status}` };
    }
    const html = (await res.text()).slice(0, 300_000).toLowerCase();
    const tokens = normalizeName(businessName);
    const words = businessName
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3);
    const flat = html.replace(/[^a-z0-9]+/g, "");
    const matches = (tokens.length > 4 && flat.includes(tokens)) || words.some((w) => flat.includes(w));
    return {
      reachable: true,
      matches,
      note: matches ? "Live page mentioning the business name" : "Live page but the business name was not found on it",
    };
  } catch (e) {
    return { reachable: false, matches: false, note: `Site could not be reached (${(e as Error).message})` };
  }
}
