import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { enrichLeads, getLeadSourceStatus, searchAndImportLeads } from "@/lib/leads.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/import")({
  head: () => ({ meta: [{ title: "Map Scraper — Lead Generation OS" }] }),
  component: ImportPage,
});

type Result = Awaited<ReturnType<typeof searchAndImportLeads>>;

function ImportPage() {
  const getStatus = useServerFn(getLeadSourceStatus);
  const run = useServerFn(searchAndImportLeads);
  const enrich = useServerFn(enrichLeads);
  const status = useQuery({ queryKey: ["lead-source-status"], queryFn: () => getStatus() });
  const [keyword, setKeyword] = useState("");
  const [location, setLocation] = useState("");
  const [limit, setLimit] = useState(20);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lookup, setLookup] = useState(true);
  const [lookupProgress, setLookupProgress] = useState<{ done: number; total: number } | null>(null);
  const [lookupSummary, setLookupSummary] = useState<string | null>(null);

  const active = status.data?.sources.find((s) => s.id === status.data?.active);
  const max = active?.maxResults ?? 60;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await run({ data: { keyword, location, limit: Math.min(Math.max(1, limit), max) } });
      setResult(res);
      if (lookup && res.ok && res.importedIds.length) await runLookup(res.importedIds);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function runLookup(ids: string[]) {
    setLookupSummary(null);
    setLookupProgress({ done: 0, total: ids.length });
    let emails = 0;
    let socials = 0;
    let unreachable = 0;
    let noWebsite = 0;
    for (let i = 0; i < ids.length; i += 3) {
      const chunk = ids.slice(i, i + 3);
      try {
        const res = await enrich({ data: { leadIds: chunk } });
        for (const r of res.results) {
          if (r.status === "failed") unreachable++;
          else if (r.status === "no_website") noWebsite++;
          else {
            if (r.email) emails++;
            if (r.socialCount) socials++;
          }
        }
      } catch {
        unreachable += chunk.length;
      }
      setLookupProgress({ done: Math.min(i + chunk.length, ids.length), total: ids.length });
    }
    setLookupProgress(null);
    setLookupSummary(
      `${emails} email${emails === 1 ? "" : "s"} found · ${socials} with social links · ${noWebsite} without a website · ${unreachable} site${unreachable === 1 ? "" : "s"} unreachable`,
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Map Scraper</h1>
        <p className="text-sm text-muted-foreground">
          Search real businesses by keyword and location and import them as leads. Duplicates (same listing or website) are skipped.
        </p>
      </div>

      <div className="rounded-md border p-4 text-sm">
        <div className="flex items-center gap-2">
          <span className="font-medium">Lead source:</span>
          {status.isLoading ? (
            <span className="text-muted-foreground">Checking…</span>
          ) : active ? (
            <>
              <span>{active.name}</span>
              <Badge variant={active.configured ? "default" : "destructive"}>
                {active.configured ? "Configured" : "Not configured"}
              </Badge>
            </>
          ) : (
            <Badge variant="destructive">Unknown source</Badge>
          )}
        </div>
        {active && <p className="mt-1 text-xs text-muted-foreground">{active.detail}</p>}
        {active && !active.configured && (
          <p className="mt-1 text-xs">
            Configure it in <Link to="/settings" className="underline">Settings → Lead Source</Link>.
          </p>
        )}
      </div>

      <form onSubmit={submit} className="space-y-4 rounded-md border p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="kw">Keyword</Label>
            <Input id="kw" placeholder="e.g. dentist, plumber, restaurant" value={keyword} onChange={(e) => setKeyword(e.target.value)} required minLength={2} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="loc">Location</Label>
            <Input id="loc" placeholder="e.g. Austin, TX" value={location} onChange={(e) => setLocation(e.target.value)} required minLength={2} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lim">Number of results (max {max})</Label>
            <Input id="lim" type="number" min={1} max={max} value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={lookup} onChange={(e) => setLookup(e.target.checked)} className="h-4 w-4" />
          After importing, visit each website to find a contact email and social links
        </label>
        <Button type="submit" disabled={busy || !!lookupProgress || !active?.configured}>
          {busy ? "Searching and importing…" : "Search & Import"}
        </Button>
      </form>

      {lookupProgress && (
        <p className="rounded-md border p-3 text-sm">
          Checking websites {lookupProgress.done} / {lookupProgress.total}…
        </p>
      )}
      {lookupSummary && <p className="rounded-md border p-3 text-sm">Website lookup: {lookupSummary}</p>}

      {error && <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}

      {result && !result.ok && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p className="font-medium text-destructive">{result.notConfigured ? "Lead source not configured" : "Lead source error"}</p>
          <p className="mt-1">{result.error}</p>
        </div>
      )}

      {result && result.ok && (
        <div className="rounded-md border p-4 text-sm">
          <p className="font-medium">Import finished</p>
          <ul className="mt-2 grid grid-cols-3 gap-2">
            <li>
              <span className="text-xs uppercase text-muted-foreground">Found</span>
              <div className="text-xl font-semibold">{result.found}</div>
            </li>
            <li>
              <span className="text-xs uppercase text-muted-foreground">Imported</span>
              <div className="text-xl font-semibold">{result.imported}</div>
            </li>
            <li>
              <span className="text-xs uppercase text-muted-foreground">Duplicates skipped</span>
              <div className="text-xl font-semibold">{result.duplicates}</div>
            </li>
          </ul>
          {result.found === 0 && <p className="mt-2 text-muted-foreground">No businesses matched that keyword and location.</p>}
          {result.failed.length > 0 && (
            <div className="mt-3">
              <p className="font-medium text-destructive">{result.failed.length} failed to save</p>
              <ul className="list-disc pl-5 text-xs text-muted-foreground">
                {result.failed.slice(0, 10).map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
          )}
          <Link to="/leads" className="mt-3 inline-block underline">
            View leads →
          </Link>
        </div>
      )}
    </div>
  );
}
