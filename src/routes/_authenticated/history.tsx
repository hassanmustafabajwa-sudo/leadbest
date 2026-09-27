import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/history")({
  head: () => ({ meta: [{ title: "Outreach history — Lead Generation OS" }] }),
  component: HistoryPage,
});

type Row = Tables<"outreach_messages"> & { leads: { company_name: string } | null; campaigns: { name: string } | null };

function HistoryPage() {
  const [status, setStatus] = useState("all");
  const [campaign, setCampaign] = useState("all");

  const campaigns = useQuery({
    queryKey: ["campaigns"],
    queryFn: async () => {
      const { data, error } = await supabase.from("campaigns").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const rows = useQuery({
    queryKey: ["outreach-history", status, campaign],
    queryFn: async () => {
      let q = supabase
        .from("outreach_messages")
        .select("*, leads(company_name), campaigns(name)")
        .order("created_at", { ascending: false })
        .limit(500);
      if (status !== "all") q = q.eq("status", status);
      if (campaign !== "all") q = q.eq("campaign_id", campaign);
      const { data, error } = await q;
      if (error) throw error;
      return data as Row[];
    },
  });

  const counts = (rows.data ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">Outreach history</h1>
        <span className="text-sm text-muted-foreground">
          {rows.data?.length ?? 0} messages · {counts["sent"] ?? 0} sent · {counts["failed"] ?? 0} failed · {counts["queued"] ?? 0} queued
        </span>
        <div className="ml-auto flex gap-2">
          <select className="h-8 rounded-md border bg-background px-2 text-sm" value={campaign} onChange={(e) => setCampaign(e.target.value)}>
            <option value="all">All campaigns</option>
            {campaigns.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select className="h-8 rounded-md border bg-background px-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
            {["all", "queued", "sent", "failed", "draft"].map((s) => (
              <option key={s} value={s}>
                {s === "all" ? "All statuses" : s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {rows.error && <p className="text-sm text-destructive">{(rows.error as Error).message}</p>}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Lead</th>
              <th className="px-3 py-2">Recipient</th>
              <th className="px-3 py-2">Campaign</th>
              <th className="px-3 py-2">Subject</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.data?.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                  No outreach yet.
                </td>
              </tr>
            )}
            {rows.data?.map((m) => (
              <tr key={m.id} className="border-t align-top">
                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{new Date(m.sent_at ?? m.created_at).toLocaleString()}</td>
                <td className="px-3 py-2">
                  <Link to="/leads/$leadId" params={{ leadId: m.lead_id }} className="hover:underline">
                    {m.leads?.company_name ?? "(deleted)"}
                  </Link>
                </td>
                <td className="px-3 py-2">{m.recipient_email}</td>
                <td className="px-3 py-2 text-muted-foreground">{m.campaigns?.name ?? "—"}</td>
                <td className="max-w-[260px] truncate px-3 py-2">{m.subject}</td>
                <td className="px-3 py-2">
                  <Badge variant={m.status === "failed" ? "destructive" : m.status === "sent" ? "default" : "outline"}>{m.status}</Badge>
                </td>
                <td className="max-w-[300px] px-3 py-2 text-xs text-muted-foreground">
                  {m.error_message ?? (m.gmail_message_id ? `Gmail id ${m.gmail_message_id}` : m.personalized_body ? "AI personalized" : "")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
