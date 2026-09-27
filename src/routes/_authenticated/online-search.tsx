import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  SEARCH_STAGES,
  STAGE_LABELS,
  getOnlineSearchStatus,
  startOnlineSearch,
  runSearchStage,
  listSearchRuns,
  listSearchResults,
  expandSearch,
  deleteSearchRun,
  importSearchResults,
  type SearchResultRow,
  type SearchRun,
} from "@/lib/online-search.functions";

export const Route = createFileRoute("/_authenticated/online-search")({
  component: OnlineSearchPage,
  head: () => ({
    meta: [
      { title: "Online Lead Search | Lead Generation OS" },
      {
        name: "description",
        content:
          "Research the live internet for businesses in a niche and location, and find the ones with no standalone website.",
      },
      { property: "og:title", content: "Online Lead Search | Lead Generation OS" },
      {
        property: "og:description",
        content: "Find real businesses without their own website and import them as leads.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const STATUS_LABELS: Record<string, string> = {
  no_website: "No Website Found",
  social_only: "Social Only",
  directory_only: "Directory Only",
  website_found: "Website Found",
  uncertain: "Uncertain",
};

function statusVariant(s: string): "default" | "secondary" | "outline" | "destructive" {
  if (s === "no_website") return "default";
  if (s === "social_only") return "secondary";
  if (s === "website_found") return "outline";
  return "outline";
}

type Evidence = { url: string; kind: string; note: string };
type SourceRef = { url: string; kind: string; origin: string; title?: string };

function OnlineSearchPage() {
  const navigate = useNavigate();
  const status = useServerFn(getOnlineSearchStatus);
  const start = useServerFn(startOnlineSearch);
  const stageFn = useServerFn(runSearchStage);
  const runsFn = useServerFn(listSearchRuns);
  const resultsFn = useServerFn(listSearchResults);
  const expandFn = useServerFn(expandSearch);
  const deleteFn = useServerFn(deleteSearchRun);
  const importFn = useServerFn(importSearchResults);

  const [cfg, setCfg] = useState<{ configured: boolean; detail: string } | null>(null);
  const [niche, setNiche] = useState("");
  const [location, setLocation] = useState("");
  const [minLeads, setMinLeads] = useState("");
  const [maxLeads, setMaxLeads] = useState("");

  const [runs, setRuns] = useState<SearchRun[]>([]);
  const [run, setRun] = useState<SearchRun | null>(null);
  const [results, setResults] = useState<SearchResultRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stageText, setStageText] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openEvidence, setOpenEvidence] = useState<string | null>(null);

  const [fStatus, setFStatus] = useState("all");
  const [fCity, setFCity] = useState("all");
  const [fCategory, setFCategory] = useState("all");
  const [fSocial, setFSocial] = useState("all");
  const [fQuality, setFQuality] = useState("all");
  const [sort, setSort] = useState("relevance");

  useEffect(() => {
    void status({}).then((s) => setCfg(s.research));
    void runsFn({}).then((r) => setRuns(r));
  }, []);

  async function refresh(runId: string) {
    const data = await resultsFn({ data: { runId } });
    setRun(data.run);
    setResults(data.results);
  }

  async function drive(runId: string, round: number) {
    setBusy(true);
    try {
      let step = 0;
      const totalSteps = SEARCH_STAGES.length + 5;
      for (const stage of SEARCH_STAGES) {
        setStageText(STAGE_LABELS[stage]);
        let out = await stageFn({ data: { runId, stage, round } });
        step++;
        setProgress(Math.round((step / totalSteps) * 100));
        if (!out.ok) {
          toast.error(out.error ?? "The search could not continue.");
          break;
        }
        // The website check runs in small batches; keep going until nothing is pending.
        let guard = 0;
        while (stage === "verify" && out.pending > 0 && guard < 5) {
          guard++;
          setStageText(`${STAGE_LABELS.verify} (${out.pending} left)`);
          out = await stageFn({ data: { runId, stage, round } });
          step++;
          setProgress(Math.min(Math.round((step / totalSteps) * 100), 99));
          if (!out.ok) break;
        }
        await refresh(runId);
      }
      setProgress(100);
      setStageText("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      void runsFn({}).then((r) => setRuns(r));
    }
  }

  async function onStart(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setResults([]);
    setSelected(new Set());
    setProgress(0);
    try {
      const res = await start({
        data: {
          niche,
          location,
          minLeads: minLeads ? Number(minLeads) : null,
          maxLeads: maxLeads ? Number(maxLeads) : null,
        },
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setRun(res.run);
      await drive(res.run.id, 1);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function onExpand() {
    if (!run || busy) return;
    try {
      const { round } = await expandFn({ data: { runId: run.id } });
      await drive(run.id, round);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function onImport() {
    const ids = [...selected];
    if (!ids.length) {
      toast.error("Select at least one business first.");
      return;
    }
    setBusy(true);
    try {
      const res = await importFn({ data: { resultIds: ids.slice(0, 100) } });
      toast.success(`${res.imported} added to Leads · ${res.duplicates} already there`);
      if (res.failed.length) toast.error(res.failed[0]!);
      setSelected(new Set());
      if (run) await refresh(run.id);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const cities = useMemo(
    () => [...new Set(results.map((r) => r.city).filter(Boolean) as string[])].sort(),
    [results],
  );
  const categories = useMemo(
    () => [...new Set(results.map((r) => r.category).filter(Boolean) as string[])].sort(),
    [results],
  );

  const shown = useMemo(() => {
    let list = results.slice();
    if (fStatus !== "all") list = list.filter((r) => r.website_status === fStatus);
    if (fCity !== "all") list = list.filter((r) => r.city === fCity);
    if (fCategory !== "all") list = list.filter((r) => r.category === fCategory);
    if (fSocial !== "all") {
      const has = (r: SearchResultRow) => Object.keys((r.social_links ?? {}) as object).length > 0;
      list = list.filter((r) => (fSocial === "yes" ? has(r) : !has(r)));
    }
    if (fQuality !== "all") {
      const min = fQuality === "high" ? 70 : fQuality === "medium" ? 45 : 0;
      const max = fQuality === "high" ? 101 : fQuality === "medium" ? 70 : 45;
      list = list.filter((r) => r.quality_score >= min && r.quality_score < max);
    }
    list.sort((a, b) =>
      sort === "name"
        ? a.business_name.localeCompare(b.business_name)
        : b.quality_score - a.quality_score || a.business_name.localeCompare(b.business_name),
    );
    return list;
  }, [results, fStatus, fCity, fCategory, fSocial, fQuality, sort]);

  const allShownSelected = shown.length > 0 && shown.every((r) => selected.has(r.id));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Online Lead Search</h1>
          <p className="text-sm text-muted-foreground">
            Research the live internet for businesses that have no website of their own.
          </p>
        </div>
        {run ? (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={busy} onClick={onExpand}>
              Search again / expand
            </Button>
            <Button size="sm" disabled={busy || selected.size === 0} onClick={onImport}>
              Import selected ({selected.size})
            </Button>
          </div>
        ) : null}
      </div>

      {cfg && !cfg.configured ? (
        <Card>
          <CardContent className="py-4 text-sm">
            <Badge variant="destructive">Not configured</Badge>
            <p className="mt-2 text-muted-foreground">{cfg.detail}</p>
            <Button variant="link" className="px-0" onClick={() => navigate({ to: "/settings" })}>
              Go to Settings → Lead Source
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">New search</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onStart} className="grid gap-3 md:grid-cols-5 md:items-end">
            <div className="md:col-span-2">
              <Label htmlFor="niche">Business type / niche</Label>
              <Input id="niche" value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="barber shop" required />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="loc">Location</Label>
              <Input id="loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Austin, TX" required />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="min">Min</Label>
                <Input id="min" inputMode="numeric" value={minLeads} onChange={(e) => setMinLeads(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="max">Max</Label>
                <Input id="max" inputMode="numeric" value={maxLeads} onChange={(e) => setMaxLeads(e.target.value)} />
              </div>
            </div>
            <div className="md:col-span-5">
              <Button type="submit" disabled={busy || (cfg ? !cfg.configured : true)}>
                {busy ? "Searching…" : "Start search"}
              </Button>
            </div>
          </form>
          {busy || stageText ? (
            <div className="mt-4 space-y-2">
              <p className="text-sm text-muted-foreground">{stageText || "Finishing up"}</p>
              <Progress value={progress} />
            </div>
          ) : null}
        </CardContent>
      </Card>

      {runs.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Recent searches:</span>
          {runs.slice(0, 8).map((r) => (
            <Button
              key={r.id}
              size="sm"
              variant={run?.id === r.id ? "secondary" : "outline"}
              disabled={busy}
              onClick={() => void refresh(r.id)}
            >
              {r.niche} · {r.location} ({r.result_count})
            </Button>
          ))}
          {run ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={async () => {
                await deleteFn({ data: { runId: run.id } });
                setRun(null);
                setResults([]);
                setRuns(await runsFn({}));
              }}
            >
              Delete this search
            </Button>
          ) : null}
        </div>
      ) : null}

      {results.length > 0 ? (
        <>
          <div className="flex flex-wrap gap-2">
            <FilterSelect value={fStatus} onChange={setFStatus} placeholder="Website status" options={[["all", "All statuses"], ...Object.entries(STATUS_LABELS)]} />
            <FilterSelect value={fCity} onChange={setFCity} placeholder="Location" options={[["all", "All locations"], ...cities.map((c) => [c, c] as [string, string])]} />
            <FilterSelect value={fCategory} onChange={setFCategory} placeholder="Category" options={[["all", "All categories"], ...categories.map((c) => [c, c] as [string, string])]} />
            <FilterSelect value={fSocial} onChange={setFSocial} placeholder="Social presence" options={[["all", "Any social presence"], ["yes", "Has social profiles"], ["no", "No social profiles"]]} />
            <FilterSelect value={fQuality} onChange={setFQuality} placeholder="Lead quality" options={[["all", "Any quality"], ["high", "High (70+)"], ["medium", "Medium (45-69)"], ["low", "Low (under 45)"]]} />
            <FilterSelect value={sort} onChange={setSort} placeholder="Sort" options={[["relevance", "Sort: prospect value"], ["name", "Sort: name"]]} />
            <span className="ml-auto self-center text-sm text-muted-foreground">{shown.length} businesses</span>
          </div>

          <div className="overflow-x-auto rounded border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="w-8 p-2">
                    <Checkbox
                      checked={allShownSelected}
                      onCheckedChange={(v) => {
                        const next = new Set(selected);
                        for (const r of shown) (v ? next.add(r.id) : next.delete(r.id));
                        setSelected(next);
                      }}
                    />
                  </th>
                  <th className="p-2 font-medium">Business</th>
                  <th className="p-2 font-medium">Website status</th>
                  <th className="p-2 font-medium">Contact</th>
                  <th className="p-2 font-medium">Online presence</th>
                  <th className="p-2 font-medium">Score</th>
                  <th className="p-2 font-medium">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const socials = (r.social_links ?? {}) as Record<string, string>;
                  const evidence = (r.website_evidence ?? []) as Evidence[];
                  const sources = (r.sources ?? []) as SourceRef[];
                  const open = openEvidence === r.id;
                  return (
                    <tr key={r.id} className="border-t align-top">
                      <td className="p-2">
                        <Checkbox
                          checked={selected.has(r.id)}
                          onCheckedChange={(v) => {
                            const next = new Set(selected);
                            if (v) next.add(r.id);
                            else next.delete(r.id);
                            setSelected(next);
                          }}
                        />
                      </td>
                      <td className="p-2">
                        <div className="font-medium">{r.business_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {[r.category, r.city, r.country].filter(Boolean).join(" · ") || "—"}
                        </div>
                        {r.imported_lead_id ? (
                          <Badge variant="outline" className="mt-1">
                            In Leads
                          </Badge>
                        ) : null}
                      </td>
                      <td className="p-2">
                        <Badge variant={statusVariant(r.website_status)}>
                          {STATUS_LABELS[r.website_status] ?? r.website_status}
                        </Badge>
                        {r.website ? (
                          <div className="mt-1 text-xs">
                            <a className="underline" href={r.website} target="_blank" rel="noreferrer">
                              {r.website.replace(/^https?:\/\//, "").slice(0, 40)}
                            </a>
                          </div>
                        ) : null}
                      </td>
                      <td className="p-2 text-xs">
                        <div>{r.phone ?? "—"}</div>
                        <div className="text-muted-foreground">{r.email ?? "—"}</div>
                      </td>
                      <td className="p-2 text-xs">
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(socials).map(([p, url]) => (
                            <a key={p} className="underline" href={url} target="_blank" rel="noreferrer">
                              {p}
                            </a>
                          ))}
                          {r.maps_url ? (
                            <a className="underline" href={r.maps_url} target="_blank" rel="noreferrer">
                              maps
                            </a>
                          ) : null}
                          {!Object.keys(socials).length && !r.maps_url ? <span>—</span> : null}
                        </div>
                      </td>
                      <td className="p-2">{r.quality_score}</td>
                      <td className="p-2">
                        <Button size="sm" variant="ghost" onClick={() => setOpenEvidence(open ? null : r.id)}>
                          {open ? "Hide" : `${sources.length} sources`}
                        </Button>
                        {open ? (
                          <div className="mt-2 max-w-md space-y-2 text-xs">
                            {evidence.map((e) => (
                              <div key={`e-${e.url}`}>
                                <a className="underline" href={e.url} target="_blank" rel="noreferrer">
                                  {e.url.slice(0, 70)}
                                </a>
                                <div className="text-muted-foreground">{e.note}</div>
                              </div>
                            ))}
                            {sources.map((s) => (
                              <div key={`s-${s.url}`}>
                                <a className="underline" href={s.url} target="_blank" rel="noreferrer">
                                  {s.title || s.url.slice(0, 70)}
                                </a>
                                <div className="text-muted-foreground">{s.origin}</div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : run && !busy ? (
        <p className="text-sm text-muted-foreground">No businesses found for this search yet. Try expanding the search.</p>
      ) : null}
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  placeholder,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: [string, string][];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[190px]">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, label]) => (
          <SelectItem key={v} value={v}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
