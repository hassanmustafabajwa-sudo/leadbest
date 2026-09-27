import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Lead } from "@/lib/leads.functions";
import { personalizeEmails, processOutreachQueue, queueOutreach, type QueueSkipped, type SendResult } from "@/lib/outreach.functions";
import { getGmailConnection } from "@/lib/gmail.functions";
import { renderTemplate, isValidEmail, TEMPLATE_VARIABLES } from "@/lib/templates";
import { clearSelectedLeadIds, getSelectedLeadIds, setSelectedLeadIds } from "@/lib/selection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/outreach")({
  head: () => ({ meta: [{ title: "Outreach — Lead Generation OS" }] }),
  component: OutreachPage,
});

type Personalized = { subject: string; body: string };
type SendSummary = { sent: number; failed: number; skipped: QueueSkipped[]; results: SendResult[]; fatal: string | null };

function OutreachPage() {
  const qc = useQueryClient();
  const personalize = useServerFn(personalizeEmails);
  const queue = useServerFn(queueOutreach);
  const process = useServerFn(processOutreachQueue);
  const getGmail = useServerFn(getGmailConnection);

  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => setIds(getSelectedLeadIds()), []);

  const leadsQuery = useQuery({
    queryKey: ["outreach-leads", ids],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("leads").select("*").in("id", ids).order("company_name");
      if (error) throw error;
      return data as Lead[];
    },
  });
  const campaignsQuery = useQuery({
    queryKey: ["campaigns"],
    queryFn: async () => {
      const { data, error } = await supabase.from("campaigns").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const gmail = useQuery({ queryKey: ["gmail-connection"], queryFn: () => getGmail({ data: { origin: window.location.origin } }) });

  const [campaignId, setCampaignId] = useState<string>("new");
  const [campaignName, setCampaignName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [personalized, setPersonalized] = useState<Record<string, Personalized>>({});
  const [personalizeErrors, setPersonalizeErrors] = useState<Record<string, string>>({});
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [summary, setSummary] = useState<SendSummary | null>(null);

  const leads = leadsQuery.data ?? [];
  const sendable = useMemo(() => leads.filter((l) => isValidEmail(l.email)), [leads]);
  const noEmail = leads.length - sendable.length;
  const preview = leads.find((l) => l.id === previewId) ?? leads[0] ?? null;

  useEffect(() => {
    if (campaignId === "new") return;
    const c = campaignsQuery.data?.find((c) => c.id === campaignId);
    if (c && !subject && !body) {
      setSubject(c.subject);
      setBody(c.body);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  function removeLead(id: string) {
    const next = ids.filter((x) => x !== id);
    setIds(next);
    setSelectedLeadIds(next);
  }

  function rendered(lead: Lead): Personalized {
    return personalized[lead.id] ?? { subject: renderTemplate(subject, lead), body: renderTemplate(body, lead) };
  }

  async function runPersonalize(target: Lead[]) {
    if (!subject.trim() || !body.trim()) { toast.error("Write a subject and message first."); return; }
    setProgress({ label: "Personalizing", done: 0, total: target.length });
    const errors: Record<string, string> = { ...personalizeErrors };
    const out: Record<string, Personalized> = { ...personalized };
    let fatal: string | null = null;
    for (let i = 0; i < target.length && !fatal; i += 3) {
      const chunk = target.slice(i, i + 3);
      try {
        const res = await personalize({ data: { leadIds: chunk.map((l) => l.id), subject, body } });
        for (const r of res.results) {
          if (r.ok && r.subject && r.body) {
            out[r.leadId] = { subject: r.subject, body: r.body };
            delete errors[r.leadId];
          } else errors[r.leadId] = r.error ?? "Personalization failed";
        }
        if (res.fatal) fatal = res.error ?? "AI provider error";
      } catch (e) {
        for (const l of chunk) errors[l.id] = (e as Error).message;
      }
      setProgress({ label: "Personalizing", done: Math.min(i + chunk.length, target.length), total: target.length });
      setPersonalized({ ...out });
      setPersonalizeErrors({ ...errors });
    }
    setProgress(null);
    if (fatal) toast.error(fatal, { duration: 10000 });
    else {
      const failed = target.filter((l) => errors[l.id]).length;
      if (failed) toast.warning(`${target.length - failed} personalized, ${failed} failed`);
      else toast.success(`Personalized ${target.length} email${target.length === 1 ? "" : "s"}`);
    }
  }

  async function send() {
    setConfirmOpen(false);
    setSummary(null);
    const recipients = sendable.map((l) => {
      const r = rendered(l);
      return { leadId: l.id, subject: r.subject, body: r.body, personalized: !!personalized[l.id] };
    });
    setProgress({ label: "Queueing", done: 0, total: recipients.length });
    let queued: Array<{ messageId: string; leadId: string }> = [];
    let skipped: QueueSkipped[] = [];
    try {
      const res = await queue({
        data: {
          campaignId: campaignId === "new" ? null : campaignId,
          newCampaignName: campaignId === "new" ? campaignName.trim() || null : null,
          subject,
          body,
          recipients,
        },
      });
      if (!res.ok) {
        setProgress(null);
        { toast.error(res.error, { duration: 10000 }); return; }
      }
      queued = res.queued;
      skipped = res.skipped;
    } catch (e) {
      setProgress(null);
      { toast.error((e as Error).message, { duration: 10000 }); return; }
    }

    const results: SendResult[] = [];
    let fatal: string | null = null;
    setProgress({ label: "Sending", done: 0, total: queued.length });
    for (let i = 0; i < queued.length && !fatal; i += 5) {
      const chunk = queued.slice(i, i + 5);
      try {
        const res = await process({ data: { messageIds: chunk.map((q) => q.messageId) } });
        results.push(...res.results);
        fatal = res.fatal;
      } catch (e) {
        for (const q of chunk) results.push({ messageId: q.messageId, leadId: q.leadId, ok: false, error: (e as Error).message });
      }
      setProgress({ label: "Sending", done: Math.min(i + chunk.length, queued.length), total: queued.length });
    }
    setProgress(null);
    const sent = results.filter((r) => r.ok).length;
    setSummary({ sent, failed: results.length - sent, skipped, results, fatal });
    qc.invalidateQueries({ queryKey: ["leads"] });
    qc.invalidateQueries({ queryKey: ["outreach-leads"] });
    qc.invalidateQueries({ queryKey: ["outreach-history"] });
    qc.invalidateQueries({ queryKey: ["campaigns"] });
    if (fatal) toast.error(fatal, { duration: 12000 });
    else if (sent && results.length === sent) toast.success(`Sent ${sent} email${sent === 1 ? "" : "s"}`);
    else toast.warning(`${sent} sent, ${results.length - sent} failed`);
  }

  const canSend =
    sendable.length > 0 && subject.trim().length > 0 && body.trim().length > 0 && !progress && !!gmail.data?.connected;

  if (!ids.length) {
    return (
      <div className="space-y-2 text-sm">
        <h1 className="text-lg font-semibold">Outreach</h1>
        <p className="text-muted-foreground">
          No leads selected. Go to <Link to="/leads" className="underline">Leads</Link>, tick the businesses you want to contact and click "Compose Outreach".
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">Outreach</h1>
        <span className="text-sm text-muted-foreground">
          {leads.length} lead{leads.length === 1 ? "" : "s"} selected · {sendable.length} with email
          {noEmail > 0 && ` · ${noEmail} without email (will be skipped)`}
        </span>
        <div className="ml-auto flex items-center gap-2 text-sm">
          {gmail.isLoading ? null : gmail.data?.connected ? (
            <Badge>Gmail: {gmail.data.email}</Badge>
          ) : (
            <Link to="/settings" className="text-destructive underline">
              {gmail.data?.configured === false ? "Gmail not configured — open Settings" : "Gmail not connected — connect in Settings"}
            </Link>
          )}
        </div>
      </div>

      {progress && (
        <div className="flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span>
            {progress.label} {progress.done} / {progress.total}
          </span>
          <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} className="w-56" />
        </div>
      )}

      {summary && (
        <div className="rounded-md border p-4 text-sm">
          <p className="font-medium">
            Send finished: {summary.sent} sent, {summary.failed} failed, {summary.skipped.length} skipped
          </p>
          {summary.fatal && <p className="mt-1 text-destructive">{summary.fatal}</p>}
          {summary.skipped.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-muted-foreground">
              {summary.skipped.map((s) => (
                <li key={s.leadId}>
                  {s.company}: {s.reason}
                </li>
              ))}
            </ul>
          )}
          {summary.results.filter((r) => !r.ok).length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-destructive">
              {summary.results
                .filter((r) => !r.ok)
                .map((r) => (
                  <li key={r.messageId}>
                    {leads.find((l) => l.id === r.leadId)?.company_name ?? r.messageId}: {r.error}
                  </li>
                ))}
            </ul>
          )}
          <div className="mt-2 flex gap-3">
            <Link to="/history" className="underline">
              View history
            </Link>
            <button
              type="button"
              className="underline"
              onClick={() => {
                clearSelectedLeadIds();
                setIds([]);
              }}
            >
              Clear selection
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-4">
          <section className="space-y-3 rounded-md border p-4">
            <h2 className="text-sm font-semibold">Campaign</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <select className="h-9 rounded-md border bg-background px-2 text-sm" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
                <option value="new">New campaign</option>
                {campaignsQuery.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {campaignId === "new" && (
                <Input placeholder="Campaign name (optional)" value={campaignName} onChange={(e) => setCampaignName(e.target.value)} />
              )}
            </div>
          </section>

          <section className="space-y-3 rounded-md border p-4">
            <h2 className="text-sm font-semibold">Email</h2>
            <div className="space-y-1.5">
              <Label htmlFor="subj">Subject</Label>
              <Input id="subj" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Quick question about {{company_name}}" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="body">Message</Label>
              <Textarea id="body" rows={12} value={body} onChange={(e) => setBody(e.target.value)} placeholder={"Hi {{first_name}},\n\nI came across {{company_name}} in {{city}}…"} />
            </div>
            <p className="text-xs text-muted-foreground">
              Variables:{" "}
              {TEMPLATE_VARIABLES.map((v) => (
                <code key={v} className="mr-1 rounded bg-muted px-1">{`{{${v}}}`}</code>
              ))}
              Missing values are left blank (first name falls back to "there").
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" disabled={!!progress || !leads.length} onClick={() => runPersonalize(leads)}>
                AI Personalize all ({leads.length})
              </Button>
              {Object.keys(personalized).length > 0 && (
                <Button size="sm" variant="ghost" disabled={!!progress} onClick={() => { setPersonalized({}); setPersonalizeErrors({}); }}>
                  Revert to template
                </Button>
              )}
              <Button size="sm" className="ml-auto" disabled={!canSend} onClick={() => setConfirmOpen(true)}>
                Review & Send ({sendable.length})
              </Button>
            </div>
          </section>
        </div>

        <div className="space-y-4">
          <section className="rounded-md border">
            <div className="border-b px-4 py-2 text-sm font-semibold">Recipients</div>
            <ul className="max-h-64 divide-y overflow-y-auto text-sm">
              {leads.map((l) => (
                <li key={l.id} className={`flex items-center gap-2 px-4 py-1.5 ${preview?.id === l.id ? "bg-muted/60" : ""}`}>
                  <button type="button" className="flex-1 truncate text-left hover:underline" onClick={() => setPreviewId(l.id)}>
                    {l.company_name}
                  </button>
                  {isValidEmail(l.email) ? (
                    <span className="truncate text-xs text-muted-foreground">{l.email}</span>
                  ) : (
                    <Link to="/leads/$leadId" params={{ leadId: l.id }} className="text-xs text-destructive underline">
                      no email — add
                    </Link>
                  )}
                  {personalized[l.id] && <Badge variant="outline">AI</Badge>}
                  {personalizeErrors[l.id] && (
                    <Badge variant="destructive" title={personalizeErrors[l.id]}>
                      AI failed
                    </Badge>
                  )}
                  <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => removeLead(l.id)} aria-label="Remove">
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-md border">
            <div className="flex items-center gap-2 border-b px-4 py-2 text-sm">
              <span className="font-semibold">Preview</span>
              {preview && <span className="text-muted-foreground">— {preview.company_name}</span>}
              {preview && (
                <Button size="sm" variant="ghost" className="ml-auto" disabled={!!progress} onClick={() => runPersonalize([preview])}>
                  {personalized[preview.id] ? "Re-personalize" : "AI Personalize this one"}
                </Button>
              )}
            </div>
            {preview ? (
              <div className="space-y-2 p-4 text-sm">
                <p>
                  <span className="text-muted-foreground">To:</span> {preview.email ?? <span className="text-destructive">(no email)</span>}
                </p>
                <p>
                  <span className="text-muted-foreground">Subject:</span> {rendered(preview).subject || <em className="text-muted-foreground">empty</em>}
                </p>
                <pre className="whitespace-pre-wrap rounded bg-muted/40 p-3 font-sans">{rendered(preview).body || "(empty message)"}</pre>
                {personalizeErrors[preview.id] && <p className="text-xs text-destructive">AI: {personalizeErrors[preview.id]}</p>}
              </div>
            ) : (
              <p className="p-4 text-sm text-muted-foreground">Select a recipient to preview.</p>
            )}
          </section>
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Send to {sendable.length} lead{sendable.length === 1 ? "" : "s"}?</DialogTitle>
            <DialogDescription>
              Emails are sent one by one from {gmail.data?.email}. Leads without a valid email and duplicates already sent in this campaign are skipped.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>
              <span className="text-muted-foreground">Recipients:</span> {sendable.length}
              {noEmail > 0 && <span className="text-muted-foreground"> ({noEmail} skipped, no email)</span>}
            </p>
            <p>
              <span className="text-muted-foreground">Subject:</span> {sendable[0] ? rendered(sendable[0]).subject : subject}
            </p>
            <p>
              <span className="text-muted-foreground">Personalized:</span> {sendable.filter((l) => personalized[l.id]).length} of {sendable.length}
            </p>
            {sendable[0] && (
              <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-muted/40 p-3 font-sans text-xs">{rendered(sendable[0]).body}</pre>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={send}>Send to {sendable.length} Lead{sendable.length === 1 ? "" : "s"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
