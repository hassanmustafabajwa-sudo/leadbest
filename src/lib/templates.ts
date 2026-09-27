// Client-safe template helpers shared by the composer UI and the server.

export type TemplateLead = {
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  industry?: string | null;
  city?: string | null;
  country?: string | null;
  website?: string | null;
};

export const TEMPLATE_VARIABLES = [
  "first_name",
  "last_name",
  "company_name",
  "industry",
  "city",
  "country",
  "website",
] as const;

/**
 * Replace {{variable}} placeholders with lead values. Missing values are
 * replaced with a safe fallback ("there" for first_name, otherwise empty)
 * so the output never contains "undefined" or raw braces.
 */
export function renderTemplate(template: string, lead: TemplateLead): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_m, key: string) => {
    const k = key.toLowerCase() as keyof TemplateLead;
    const value = lead[k];
    if (value && String(value).trim()) return String(value).trim();
    if (k === "first_name") return "there";
    return "";
  });
}

/** Returns template variables that are empty for this lead (for warnings). */
export function missingVariables(template: string, lead: TemplateLead): string[] {
  const found = new Set<string>();
  for (const m of template.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)) {
    const k = (m[1] ?? "").toLowerCase() as keyof TemplateLead;
    if (!lead[k] || !String(lead[k]).trim()) found.add(k);
  }
  return [...found];
}

export function isValidEmail(email: string | null | undefined): email is string {
  return !!email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
