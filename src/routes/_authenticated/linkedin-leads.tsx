import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  getLinkedInLeadsStatus,
  searchLinkedInLeads,
  enrichLinkedInLead,
  saveLinkedInLead,
  importLinkedInLeadAsLead,
  type LinkedInLeadResult,
} from "@/lib/linkedin-leads.functions";
import { DECISION_MAKER_ROLES, TARGET_SERVICES, confidenceLabel } from "@/lib/people-search-shared";

export const Route = createFileRoute("/_authenticated/linkedin-leads")({
  component: LinkedInLeadsPage,
  head: () => ({
    meta: [
      { title: "LinkedIn Leads | Lead Generation OS" },
      {
        name: "description",
        content: "Discover potential prospects and decision makers through public professional-web discovery.",
      },
    ],
  }),
});

function confidenceVariant(c: number): "default" | "secondary" | "outline" {
  const label = confidenceLabel(c);
  if (label === "high") return "default";
  if (label === "medium") return "secondary";
  return "outline";
}

function LinkedInLeadsPage() {
  const statusFn = useServerFn(getLinkedInLeadsStatus);
  const searchFn = useServerFn(searchLinkedInLeads);
  const enrichFn = useServerFn(enrichLinkedInLead);
  const saveFn = useServerFn(saveLinkedInLead);
  const importFn = useServerFn(importLinkedInLeadAsLead);

  const [cfg, setCfg] = useState<{ research: { configured: boolean; detail: string }; aiConfigured: boolean } | null>(null);
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [role, setRole] = useState("Any");
  const [service, setService] = useState<string>("__none");

  const [busy, setBusy] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<LinkedInLeadResult[]>([]);
  const [busyIndex, setBusyIndex] = useState<number | null>(null);
  const [savedKeys, setSavedKeys] = useState<Set<number>>(new Set());

  useEffect(() => {
    void statusFn().then((s) => setCfg(s));
  }, []);

  async function runSearch() {
    if (query.trim().length < 2) {
      toast.error("Enter a search query (e.g. restaurant owners, real estate founders).");
      return;
    }
    setBusy(true);
    setError(null);
    setResults([]);
    setSavedKeys(new Set());
    try {
      setStatusText("Searching public LinkedIn profiles...");
      const res = await searchFn({
        data: {
          query: query.trim(),
          location: location.trim(),
          role,
          service: service === "__none" ? null : service,
        },
      });
      if (!res.ok) {
        setError(res.error ?? "Search failed.");
        toast.error(res.error ?? "Search failed.");
        return;
      }
      setStatusText("Analyzing results...");
      setResults(res.results);
      if (res.results.length === 0) {
        toast.message("No LinkedIn leads found. Try a broader industry, role, or location.");
      }
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
      setStatusText("");
    }
  }

  async function enrichOne(i: number) {
    const lead = results[i];
    if (!lead) return;
    setBusyIndex(i);
    try {
      const res = await enrichFn({ data: lead });
      if (!res.ok) {
        toast.error(res.error ?? "Enrichment failed.");
        return;
      }
      if (res.result) {
        setResults((prev) => prev.map((p, idx) => (idx === i ? res.result! : p)));
        toast.success("Enrichment finished.");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyIndex(null);
    }
  }

  async function saveOne(i: number) {
    const lead = results[i];
    if (!lead) return;
    setBusyIndex(i);
    try {
      const res = await saveFn({ data: lead });
      if (!res.ok) {
        toast.error(res.error ?? "Could not save this lead.");
        return;
      }
      setSavedKeys((prev) => new Set(prev).add(i));
      toast.success(`Saved ${lead.fullName}.`);
      if (res.id) {
        const imp = await importFn({ data: { id: res.id } });
        if (imp.ok && !imp.duplicate) toast.success("Added to Leads too.");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyIndex(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">LinkedIn Leads</h1>
        <p className="text-sm text-muted-foreground">
          Discover potential prospects and decision makers through public professional-web discovery. Uses public
          search only — no private LinkedIn access, scraping, or credential collection.
        </p>
      </div>

      {cfg && !cfg.research.configured && (
        <Card className="border-dashed">
          <CardContent className="pt-6 text-sm text-muted-foreground">Not configured — {cfg.research.detail}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Search / filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="li-query">Search Query</Label>
            <Input
              id="li-query"
              placeholder="restaurant owners, real estate founders, ecommerce CEOs"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="li-location">Location</Label>
            <Input id="li-location" placeholder="Lahore, Dubai, United States" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Any">Any</SelectItem>
                {DECISION_MAKER_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Target Service</Label>
            <Select value={service} onValueChange={setService}>
              <SelectTrigger>
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">None</SelectItem>
                {TARGET_SERVICES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <Button onClick={runSearch} disabled={busy || (cfg ? !cfg.research.configured : false)}>
              {busy ? statusText || "Searching..." : "Find LinkedIn Leads"}
            </Button>
            {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
          </div>
        </CardContent>
      </Card>

      {results.length === 0 && !busy && (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No LinkedIn leads found yet.
            <br />
            Search by industry, role and location to discover relevant professional profiles.
          </CardContent>
        </Card>
      )}

      {results.length > 0 && (
        <div className="space-y-3">
          {results.map((p, i) => (
            <Card key={`${p.linkedinUrl ?? p.fullName}-${i}`}>
              <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{p.fullName ?? "Unknown"}</span>
                    <Badge variant={confidenceVariant(p.confidence)}>{confidenceLabel(p.confidence)} confidence</Badge>
                    {savedKeys.has(i) && <Badge variant="secondary">Saved</Badge>}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {p.jobTitle ?? "Role not confirmed"} {p.companyName ? `at ${p.companyName}` : ""}
                  </div>
                  {p.headline && <div className="text-xs text-muted-foreground">{p.headline}</div>}
                  <div className="text-xs text-muted-foreground">{p.location ?? "Location unknown"}</div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <span>
                      Email: {p.professionalEmail ? <span className="text-foreground">{p.professionalEmail}</span> : "Not found"}
                    </span>
                    <span>
                      Phone: {p.professionalPhone ? <span className="text-foreground">{p.professionalPhone}</span> : "Not found"}
                    </span>
                    {p.linkedinUrl ? (
                      <a href={p.linkedinUrl} target="_blank" rel="noreferrer" className="text-primary underline">
                        Open Profile
                      </a>
                    ) : (
                      <span>LinkedIn profile not verified</span>
                    )}
                  </div>
                  {p.evidence.length > 0 && (
                    <p className="max-w-2xl text-xs text-muted-foreground">Evidence: {p.evidence[0]}</p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" variant="outline" disabled={busyIndex === i} onClick={() => enrichOne(i)}>
                    {busyIndex === i ? "Working..." : "Enrich Contact"}
                  </Button>
                  <Button size="sm" disabled={busyIndex === i || savedKeys.has(i)} onClick={() => saveOne(i)}>
                    {savedKeys.has(i) ? "Saved" : "Save Lead"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
