import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { analyzeLeads, enrichLeads, type Lead } from "@/lib/leads.functions";
import { setSelectedLeadIds } from "@/lib/selection";
import type { Tables } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { qualVariant } from "./index";

export const Route = createFileRoute("/_authenticated/leads/$leadId")({
  head: () => ({ meta: [{ title: "Lead details — Lead Generation OS" }] }),
  component: LeadDetailPage,
});

type Analysis = {
  score?: number;
  qualification?: string;
  recommended_service?: string;
  reason?: string;
  website_quality?: string;
  social_presence?: string;
  opportunities?: string[];
  missing_information?: string[];
  provider?: string;
  analyzed_at?: string;
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value ?? <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

function LeadDetailPage() {
  const { leadId } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const analyze = useServerFn(analyzeLeads);
  const enrich = useServerFn(enrichLeads);
  const [analyzing, setAnalyzing] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [contact, setContact] = useState({ first_name: "", last_name: "", email: "" });
  const [saving, setSaving] = useState(false);

  const leadQuery = useQuery({
    queryKey: ["lead", leadId],
    queryFn: async () => {
      const { data, error } = await supabase.from("leads").select("*").eq("id", leadId).single();
      if (error) throw error;
      return data as Lead;
    },
  });
  const historyQuery = useQuery({
    queryKey: ["outreach", leadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("outreach_messages")
        .select("*, campaigns(name)")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Array<Tables<"outreach_messages"> & { campaigns: { name: string } | null }>;
    },
  });

  const lead = leadQuery.data;
  useEffect(() => {
    if (lead) setContact({ first_name: lead.first_name ?? "", last_name: lead.last_name ?? "", email: lead.email ?? "" });
  }, [lead]);

  async function runAnalysis() {
    setAnalyzing(true);
    try {
      const res = await analyze({ data: { leadIds: [leadId] } });
      if (res.notConfigured) toast.error(res.error, { duration: 10000 });
      else {
        const r = res.results[0];
        if (r?.ok) toast.success(`Analyzed: score ${r.score}, ${r.qualification}`);
        else toast.error(r?.error ?? res.error ?? "Analysis failed", { duration: 10000 });
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAnalyzing(false);
      qc.invalidateQueries({ queryKey: ["lead", leadId] });
      qc.invalidateQueries({ queryKey: ["leads"] });
    }
  }

  async function runEnrichment() {
    setEnriching(true);
    try {
      const res = await enrich({ data: { leadIds: [leadId] } });
      const r = res.results[0];
      if (!r) toast.error("Lookup returned nothing");
      else if (r.status === "failed") toast.error(r.error ?? "Website could not be reached", { duration: 10000 });
      else if (r.status === "no_website") toast.warning("This lead has no website to check");
      else if (r.status === "nothing") toast.warning("No email or social links published on that website");
      else toast.success(`${r.email ? `Email: ${r.email}` : "No email found"} · ${r.socialCount ?? 0} social link(s)`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setEnriching(false);
      qc.invalidateQueries({ queryKey: ["lead", leadId] });
      qc.invalidateQueries({ queryKey: ["leads"] });
    }
  }

  async function saveContact() {
    setSaving(true);
    const { error } = await supabase
      .from("leads")
      .update({
        first_name: contact.first_name.trim() || null,
        last_name: contact.last_name.trim() || null,
        email: contact.email.trim() || null,
      })
      .eq("id", leadId);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Contact details saved");
    qc.invalidateQueries({ queryKey: ["lead", leadId] });
    qc.invalidateQueries({ queryKey: ["leads"] });
  }

  async function remove() {
    if (!confirm("Delete this lead and its outreach history?")) return;
    const { error } = await supabase.from("leads").delete().eq("id", leadId);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["leads"] });
    navigate({ to: "/leads" });
  }

  if (leadQuery.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (leadQuery.error || !lead)
    return <p className="text-sm text-destructive">{(leadQuery.error as Error)?.message ?? "Lead not found"}</p>;

  const a = (lead.ai_analysis ?? null) as Analysis | null;
  const socialEntries = Object.entries((lead.social_links ?? {}) as Record<string, string>).filter(
    ([, v]) => typeof v === "string" && v,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/leads" className="text-sm text-muted-foreground hover:underline">
          ← Leads
        </Link>
        <h1 className="text-lg font-semibold">{lead.company_name}</h1>
        <Badge variant={qualVariant(lead.qualification_status)}>{lead.qualification_status}</Badge>
        <Badge variant="outline">outreach: {lead.outreach_status}</Badge>
        <div className="ml-auto flex gap-2">
          <Button size="sm" onClick={runAnalysis} disabled={analyzing}>
            {analyzing ? "Analyzing…" : "Analyze Lead"}
          </Button>
          <Button size="sm" variant="outline" onClick={runEnrichment} disabled={enriching}>
            {enriching ? "Checking website…" : "Find Contact Details"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setSelectedLeadIds([lead.id]);
              navigate({ to: "/outreach" });
            }}
          >
            Compose Email
          </Button>
          <Button size="sm" variant="destructive" onClick={remove}>
            Delete
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-md border p-4">
          <h2 className="mb-3 text-sm font-semibold">Business information</h2>
          <dl className="grid grid-cols-2 gap-3">
            <Field label="Industry" value={lead.industry} />
            <Field label="Source" value={`${lead.source}${lead.source_id ? ` · ${lead.source_id}` : ""}`} />
            <Field label="Address" value={lead.address} />
            <Field label="City / Country" value={[lead.city, lead.country].filter(Boolean).join(", ") || null} />
            <Field
              label="Website"
              value={
                lead.website ? (
                  <a href={lead.website} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                    {lead.website}
                  </a>
                ) : (
                  "No website"
                )
              }
            />
            <Field label="Phone" value={lead.phone} />
            <Field
              label="Google Maps"
              value={
                lead.maps_url ? (
                  <a href={lead.maps_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                    Open listing
                  </a>
                ) : null
              }
            />
            <Field label="Rating" value={lead.rating != null ? `${lead.rating} (${lead.review_count ?? 0} reviews)` : null} />
            <div className="col-span-2">
              <Field label="Description" value={lead.description} />
            </div>
            <Field label="Created" value={new Date(lead.created_at).toLocaleString()} />
            <Field label="Updated" value={new Date(lead.updated_at).toLocaleString()} />
          </dl>

          <h2 className="mb-2 mt-6 text-sm font-semibold">Website lookup</h2>
          <dl className="grid grid-cols-2 gap-3">
            <Field
              label="Status"
              value={
                lead.enrichment_status === "none"
                  ? "Not checked yet"
                  : lead.enrichment_status === "no_website"
                    ? "No website to check"
                    : lead.enrichment_status === "failed"
                      ? `Failed: ${lead.enrichment_error ?? "unreachable"}`
                      : lead.enrichment_status === "nothing"
                        ? "Checked — nothing published"
                        : `Checked${lead.enriched_at ? ` ${new Date(lead.enriched_at).toLocaleString()}` : ""}`
              }
            />
            <Field
              label="Contact page"
              value={
                lead.contact_page_url ? (
                  <a href={lead.contact_page_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                    Open
                  </a>
                ) : null
              }
            />
            <div className="col-span-2">
              <Field
                label="Social links"
                value={
                  socialEntries.length ? (
                    <ul className="space-y-0.5">
                      {socialEntries.map(([k, v]) => (
                        <li key={k}>
                          <span className="capitalize text-muted-foreground">{k}: </span>
                          <a href={v} target="_blank" rel="noreferrer" className="text-primary hover:underline break-all">
                            {v}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : null
                }
              />
            </div>
          </dl>

          <h2 className="mb-3 mt-6 text-sm font-semibold">Contact (editable)</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Map sources rarely expose an email. Add one here before sending outreach.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="fn">First name</Label>
              <Input id="fn" value={contact.first_name} onChange={(e) => setContact({ ...contact, first_name: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ln">Last name</Label>
              <Input id="ln" value={contact.last_name} onChange={(e) => setContact({ ...contact, last_name: e.target.value })} />
            </div>
            <div className="col-span-2 space-y-1">
              <Label htmlFor="em">Email</Label>
              <Input id="em" type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
            </div>
          </div>
          <Button size="sm" className="mt-3" onClick={saveContact} disabled={saving}>
            {saving ? "Saving…" : "Save contact"}
          </Button>
        </section>

        <section className="rounded-md border p-4">
          <h2 className="mb-3 text-sm font-semibold">AI analysis</h2>
          {!a ? (
            <p className="text-sm text-muted-foreground">Not analyzed yet. Click "Analyze Lead" to qualify this business.</p>
          ) : (
            <dl className="grid grid-cols-2 gap-3">
              <Field label="AI score" value={<span className="text-2xl font-semibold">{lead.ai_score}</span>} />
              <Field label="Qualification" value={<Badge variant={qualVariant(lead.qualification_status)}>{lead.qualification_status}</Badge>} />
              <Field label="Recommended service" value={lead.recommended_service} />
              <Field label="Website quality" value={a.website_quality} />
              <Field label="Social presence" value={a.social_presence} />
              <Field label="Provider" value={a.provider ? `${a.provider} · ${a.analyzed_at ? new Date(a.analyzed_at).toLocaleString() : ""}` : null} />
              <div className="col-span-2">
                <Field label="Reason" value={<p className="whitespace-pre-wrap">{a.reason}</p>} />
              </div>
              <div className="col-span-2">
                <Field
                  label="Opportunities"
                  value={a.opportunities?.length ? <ul className="list-disc pl-5">{a.opportunities.map((o, i) => <li key={i}>{o}</li>)}</ul> : "None listed"}
                />
              </div>
              <div className="col-span-2">
                <Field
                  label="Missing information"
                  value={a.missing_information?.length ? a.missing_information.join(", ") : "None"}
                />
              </div>
            </dl>
          )}
        </section>
      </div>

      <section className="rounded-md border p-4">
        <h2 className="mb-3 text-sm font-semibold">Outreach history</h2>
        {historyQuery.data?.length ? (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">Date</th>
                <th className="py-1 pr-3">Campaign</th>
                <th className="py-1 pr-3">To</th>
                <th className="py-1 pr-3">Subject</th>
                <th className="py-1 pr-3">Status</th>
                <th className="py-1 pr-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {historyQuery.data.map((m) => (
                <tr key={m.id} className="border-t align-top">
                  <td className="py-2 pr-3 text-muted-foreground">{new Date(m.sent_at ?? m.created_at).toLocaleString()}</td>
                  <td className="py-2 pr-3">{m.campaigns?.name ?? "—"}</td>
                  <td className="py-2 pr-3">{m.recipient_email}</td>
                  <td className="py-2 pr-3">{m.subject}</td>
                  <td className="py-2 pr-3">
                    <Badge variant={m.status === "failed" ? "destructive" : m.status === "sent" ? "default" : "outline"}>{m.status}</Badge>
                  </td>
                  <td className="py-2 pr-3 text-xs text-muted-foreground">
                    {m.error_message ?? (m.gmail_message_id ? `Gmail id ${m.gmail_message_id}` : "")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-muted-foreground">No outreach sent to this lead yet.</p>
        )}
      </section>
    </div>
  );
}
