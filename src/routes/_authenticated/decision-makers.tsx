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
  getDecisionMakersStatus,
  searchDecisionMakers,
  enrichDecisionMaker,
  saveDecisionMaker,
  importDecisionMakerAsLead,
  type DecisionMakerResult,
} from "@/lib/decision-makers.functions";
import { DECISION_MAKER_ROLES, TARGET_SERVICES, confidenceLabel } from "@/lib/people-search-shared";

export const Route = createFileRoute("/_authenticated/decision-makers")({
  component: DecisionMakersPage,
  head: () => ({
    meta: [
      { title: "Decision Makers | Lead Generation OS" },
      {
        name: "description",
        content: "Find the real founders, owners, and executives behind a business — not generic company inboxes.",
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

function DecisionMakersPage() {
  const statusFn = useServerFn(getDecisionMakersStatus);
  const searchFn = useServerFn(searchDecisionMakers);
  const enrichFn = useServerFn(enrichDecisionMaker);
  const saveFn = useServerFn(saveDecisionMaker);
  const importFn = useServerFn(importDecisionMakerAsLead);

  const [cfg, setCfg] = useState<{ research: { configured: boolean; detail: string }; aiConfigured: boolean } | null>(null);
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [role, setRole] = useState("Any");
  const [service, setService] = useState<string>("__none");

  const [busy, setBusy] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<DecisionMakerResult[]>([]);
  const [busyIndex, setBusyIndex] = useState<number | null>(null);
  const [savedKeys, setSavedKeys] = useState<Set<number>>(new Set());

  useEffect(() => {
    void statusFn().then((s) => setCfg(s));
  }, []);

  async function runSearch() {
    if (query.trim().length < 2) {
      toast.error("Enter a business, company, or industry to search for.");
      return;
    }
    setBusy(true);
    setError(null);
    setResults([]);
    setSavedKeys(new Set());
    try {
      setStatusText("Researching businesses...");
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
      setStatusText("Verifying professional profiles...");
      setResults(res.results);
      if (res.results.length === 0) {
        toast.message("No verified decision makers found. Try a broader company, location, or role.");
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
    const person = results[i];
    if (!person) return;
    setBusyIndex(i);
    try {
      const res = await enrichFn({ data: person });
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
    const person = results[i];
    if (!person) return;
    setBusyIndex(i);
    try {
      const res = await saveFn({ data: person });
      if (!res.ok) {
        toast.error(res.error ?? "Could not save this lead.");
        return;
      }
      setSavedKeys((prev) => new Set(prev).add(i));
      toast.success(`Saved ${person.fullName}.`);
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
        <h1 className="text-xl font-semibold tracking-tight">Decision Makers</h1>
        <p className="text-sm text-muted-foreground">
          Find the actual people who make business decisions — founders, owners, CEOs, directors — instead of a
          generic info@ inbox.
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
            <Label htmlFor="dm-query">Business / Company / Query</Label>
            <Input
              id="dm-query"
              placeholder="restaurants in Lahore, or ABC Construction"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dm-location">Location</Label>
            <Input id="dm-location" placeholder="Lahore, Pakistan" value={location} onChange={(e) => setLocation(e.target.value)} />
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
              {busy ? statusText || "Searching..." : "Find Decision Makers"}
            </Button>
            {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
          </div>
        </CardContent>
      </Card>

      {results.length === 0 && !busy && (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No decision makers found yet.
            <br />
            Search for a company, industry, or location to discover founders, owners, CEOs and other business
            decision makers.
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
                  <div className="text-xs text-muted-foreground">{p.location ?? "Location unknown"}</div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <span>
                      Email: {p.professionalEmail ? <span className="text-foreground">{p.professionalEmail}</span> : "Not found"}
                    </span>
                    <span>
                      Phone: {p.professionalPhone ? <span className="text-foreground">{p.professionalPhone}</span> : "Not found"}
                    </span>
                    {p.linkedinUrl && (
                      <a href={p.linkedinUrl} target="_blank" rel="noreferrer" className="text-primary underline">
                        Open LinkedIn
                      </a>
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
