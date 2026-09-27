import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { analyzeLeads, enrichLeads, type Lead } from "@/lib/leads.functions";
import { markLeadsSelected } from "@/lib/outreach.functions";
import { setSelectedLeadIds } from "@/lib/selection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/leads/")({
  head: () => ({ meta: [{ title: "Leads — Lead Generation OS" }] }),
  component: LeadsPage,
});

type SortKey = "created_at" | "company_name" | "ai_score" | "rating" | "review_count";

const QUAL_OPTIONS = ["all", "new", "high", "medium", "low", "unqualified"];
const OUTREACH_OPTIONS = ["all", "none", "selected", "draft", "sent", "failed"];

export function qualVariant(q: string): "default" | "secondary" | "outline" | "destructive" {
  if (q === "high") return "default";
  if (q === "medium") return "secondary";
  if (q === "unqualified") return "destructive";
  return "outline";
}

function LeadsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const analyze = useServerFn(analyzeLeads);
  const enrich = useServerFn(enrichLeads);
  const markSelected = useServerFn(markLeadsSelected);

  const [search, setSearch] = useState("");
  const [qual, setQual] = useState("all");
  const [outreach, setOutreach] = useState("all");
  const [sort, setSort] = useState<SortKey>("created_at");
  const [asc, setAsc] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const leadsQuery = useQuery({
    queryKey: ["leads", { search, qual, outreach, sort, asc }],
    queryFn: async () => {
      let q = supabase.from("leads").select("*").order(sort, { ascending: asc, nullsFirst: false }).limit(1000);
      if (qual !== "all") q = q.eq("qualification_status", qual);
      if (outreach !== "all") q = q.eq("outreach_status", outreach);
      if (search.trim()) {
        const s = `%${search.trim().replace(/[%_]/g, "")}%`;
        q = q.or(`company_name.ilike.${s},email.ilike.${s},website.ilike.${s},industry.ilike.${s},city.ilike.${s}`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data as Lead[];
    },
  });

  const leads = leadsQuery.data ?? [];
  const allChecked = leads.length > 0 && leads.every((l) => selected.has(l.id));
  const selectedIds = useMemo(() => [...selected], [selected]);

  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(leads.map((l) => l.id)));
  }
  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }
  function header(label: string, key: SortKey) {
    return (
      <button
        type="button"
        className="inline-flex items-center gap-1 font-medium hover:underline"
        onClick={() => {
          if (sort === key) setAsc(!asc);
          else {
            setSort(key);
            setAsc(key === "company_name");
          }
        }}
      >
        {label}
        {sort === key && <span className="text-xs">{asc ? "▲" : "▼"}</span>}
      </button>
    );
  }

  async function analyzeSelected() {
    const ids = selectedIds;
    if (!ids.length) return;
    setProgress({ done: 0, total: ids.length, label: "Analyzing" });
    const failed: string[] = [];
    let fatal: string | null = null;
    for (let i = 0; i < ids.length && !fatal; i += 3) {
      const chunk = ids.slice(i, i + 3);
      try {
        const res = await analyze({ data: { leadIds: chunk } });
        if (res.notConfigured) {
          fatal = res.error;
          break;
        }
        for (const r of res.results) if (!r.ok) failed.push(r.error ?? "Unknown error");
        if ("fatal" in res && res.fatal) fatal = res.error ?? "AI provider error";
      } catch (e) {
        failed.push((e as Error).message);
      }
      setProgress({ done: Math.min(i + chunk.length, ids.length), total: ids.length, label: "Analyzing" });
      qc.invalidateQueries({ queryKey: ["leads"] });
    }
    setProgress(null);
    qc.invalidateQueries({ queryKey: ["leads"] });
    if (fatal) toast.error(fatal, { duration: 10000 });
    else if (failed.length) {
      toast.warning(`${ids.length - failed.length} analyzed, ${failed.length} failed`, {
        description: failed.slice(0, 3).join(" · "),
        duration: 10000,
      });
    } else toast.success(`Analyzed ${ids.length} lead${ids.length === 1 ? "" : "s"}`);
  }

  async function enrichSelected() {
    const ids = selectedIds;
    if (!ids.length) return;
    setProgress({ done: 0, total: ids.length, label: "Checking websites" });
    let emails = 0;
    let socials = 0;
    const failed: string[] = [];
    let noWebsite = 0;
    for (let i = 0; i < ids.length; i += 3) {
      const chunk = ids.slice(i, i + 3);
      try {
        const res = await enrich({ data: { leadIds: chunk } });
        for (const r of res.results) {
          if (r.status === "failed") failed.push(`${r.company}: ${r.error ?? "failed"}`);
          else if (r.status === "no_website") noWebsite++;
          else {
            if (r.email) emails++;
            if (r.socialCount) socials++;
          }
        }
      } catch (e) {
        failed.push((e as Error).message);
      }
      setProgress({ done: Math.min(i + chunk.length, ids.length), total: ids.length, label: "Checking websites" });
      qc.invalidateQueries({ queryKey: ["leads"] });
    }
    setProgress(null);
    qc.invalidateQueries({ queryKey: ["leads"] });
    const parts = [`${emails} email${emails === 1 ? "" : "s"} found`, `${socials} with social links`];
    if (noWebsite) parts.push(`${noWebsite} without a website`);
    if (failed.length) parts.push(`${failed.length} site${failed.length === 1 ? "" : "s"} unreachable`);
    if (failed.length) toast.warning(parts.join(" · "), { description: failed.slice(0, 3).join(" · "), duration: 10000 });
    else toast.success(parts.join(" · "));
  }

  async function sendToOutreach() {
    if (!selectedIds.length) return;
    setSelectedLeadIds(selectedIds);
    try {
      await markSelected({ data: { leadIds: selectedIds } });
    } catch (e) {
      toast.error((e as Error).message);
    }
    navigate({ to: "/outreach" });
  }

  async function deleteSelected() {
    const { error } = await supabase.from("leads").delete().in("id", selectedIds);
    setConfirmDelete(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Deleted ${selectedIds.length} lead${selectedIds.length === 1 ? "" : "s"}`);
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: ["leads"] });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">Leads</h1>
        <span className="text-sm text-muted-foreground">{leads.length} shown</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search name, email, website, industry, city"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-72"
          />
          <select
            className="h-8 rounded-md border bg-background px-2 text-sm"
            value={qual}
            onChange={(e) => setQual(e.target.value)}
          >
            {QUAL_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o === "all" ? "Qualification: all" : o}
              </option>
            ))}
          </select>
          <select
            className="h-8 rounded-md border bg-background px-2 text-sm"
            value={outreach}
            onChange={(e) => setOutreach(e.target.value)}
          >
            {OUTREACH_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o === "all" ? "Outreach: all" : o}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
        <span className="text-muted-foreground">{selected.size} selected</span>
        <Button size="sm" disabled={!selected.size || !!progress} onClick={analyzeSelected}>
          Analyze Selected
        </Button>
        <Button size="sm" variant="secondary" disabled={!selected.size || !!progress} onClick={enrichSelected}>
          Find Emails & Socials
        </Button>
        <Button size="sm" variant="secondary" disabled={!selected.size || !!progress} onClick={sendToOutreach}>
          Compose Outreach
        </Button>
        <Button size="sm" variant="destructive" disabled={!selected.size || !!progress} onClick={() => setConfirmDelete(true)}>
          Delete
        </Button>
        {progress && (
          <div className="ml-auto flex items-center gap-2">
            <span>
              {progress.label} {progress.done} / {progress.total}
            </span>
            <Progress value={(progress.done / progress.total) * 100} className="w-40" />
          </div>
        )}
      </div>

      {leadsQuery.error && <p className="text-sm text-destructive">{(leadsQuery.error as Error).message}</p>}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="w-8 px-3 py-2">
                <Checkbox checked={allChecked} onCheckedChange={toggleAll} aria-label="Select all" />
              </th>
              <th className="px-3 py-2">{header("Business", "company_name")}</th>
              <th className="px-3 py-2">Industry</th>
              <th className="px-3 py-2">Location</th>
              <th className="px-3 py-2">Website</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">{header("Rating", "rating")}</th>
              <th className="px-3 py-2">{header("AI score", "ai_score")}</th>
              <th className="px-3 py-2">Qualification</th>
              <th className="px-3 py-2">Outreach</th>
            </tr>
          </thead>
          <tbody>
            {leadsQuery.isLoading && (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
            {!leadsQuery.isLoading && leads.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-10 text-center text-muted-foreground">
                  No leads yet.{" "}
                  <Link to="/import" className="underline">
                    Import businesses from the Map Scraper
                  </Link>
                  .
                </td>
              </tr>
            )}
            {leads.map((l) => (
              <tr key={l.id} className="border-t hover:bg-muted/30">
                <td className="px-3 py-2">
                  <Checkbox checked={selected.has(l.id)} onCheckedChange={() => toggle(l.id)} aria-label="Select lead" />
                </td>
                <td className="px-3 py-2">
                  <Link to="/leads/$leadId" params={{ leadId: l.id }} className="font-medium hover:underline">
                    {l.company_name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{l.industry ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">{[l.city, l.country].filter(Boolean).join(", ") || "—"}</td>
                <td className="max-w-[180px] truncate px-3 py-2">
                  {l.website ? (
                    <a href={l.website} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                      {l.website.replace(/^https?:\/\/(www\.)?/, "")}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">none</span>
                  )}
                </td>
                <td className="px-3 py-2">{l.email ?? <span className="text-muted-foreground">—</span>}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {l.rating != null ? `${l.rating} (${l.review_count ?? 0})` : "—"}
                </td>
                <td className="px-3 py-2 font-medium">{l.ai_score ?? "—"}</td>
                <td className="px-3 py-2">
                  <Badge variant={qualVariant(l.qualification_status)}>{l.qualification_status}</Badge>
                </td>
                <td className="px-3 py-2">
                  <Badge variant={l.outreach_status === "failed" ? "destructive" : "outline"}>{l.outreach_status}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selected.size} lead(s)?</AlertDialogTitle>
            <AlertDialogDescription>This also removes their outreach history. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteSelected}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
