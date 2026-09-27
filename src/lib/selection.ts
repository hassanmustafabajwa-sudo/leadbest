// Lead selection carried from the Leads table to the Outreach composer.
const KEY = "lgos.selectedLeadIds";

export function getSelectedLeadIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function setSelectedLeadIds(ids: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(ids));
}

export function clearSelectedLeadIds() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
}
