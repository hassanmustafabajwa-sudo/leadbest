import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getSettingsOverview, saveSettings } from "@/lib/settings.functions";
import { disconnectGmailAccount, getGmailConnection, startGmailConnect } from "@/lib/gmail.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — Lead Generation OS" }] }),
  component: SettingsPage,
});

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function SettingsPage() {
  const qc = useQueryClient();
  const getOverview = useServerFn(getSettingsOverview);
  const save = useServerFn(saveSettings);
  const getGmail = useServerFn(getGmailConnection);
  const startConnect = useServerFn(startGmailConnect);
  const disconnect = useServerFn(disconnectGmailAccount);

  const overview = useQuery({ queryKey: ["settings-overview"], queryFn: () => getOverview() });
  const gmail = useQuery({
    queryKey: ["gmail-connection"],
    queryFn: () => getGmail({ data: { origin: window.location.origin } }),
  });

  const [provider, setProvider] = useState<"lovable" | "openrouter" | "gemini">("lovable");
  const [model, setModel] = useState("");
  const [source, setSource] = useState("google_maps");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const s = overview.data?.settings;
    if (s) {
      setProvider(s.ai_provider as typeof provider);
      setModel(s.ai_model ?? "");
      setSource(s.lead_source);
    }
  }, [overview.data]);

  useEffect(() => {
    function onMsg(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === "gmail-oauth") {
        qc.invalidateQueries({ queryKey: ["gmail-connection"] });
        qc.invalidateQueries({ queryKey: ["settings-overview"] });
        if (e.data.ok) toast.success("Gmail connected");
        else toast.error("Gmail connection failed. Check the popup for details.");
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [qc]);

  async function onSave() {
    setSaving(true);
    try {
      await save({ data: { ai_provider: provider, ai_model: model.trim() || null, lead_source: source } });
      toast.success("Settings saved");
      qc.invalidateQueries({ queryKey: ["settings-overview"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function connectGmail() {
    const res = await startConnect({ data: { origin: window.location.origin } });
    if (!res.ok) { toast.error(res.error, { duration: 10000 }); return; }
    const w = window.open(res.url, "gmail-oauth", "width=520,height=680");
    if (!w) window.location.href = res.url;
  }

  async function disconnectGmail() {
    if (!confirm("Disconnect Gmail? Sending will stop until you reconnect.")) return;
    try {
      await disconnect();
      toast.success("Gmail disconnected");
    } catch (e) {
      toast.error((e as Error).message);
    }
    qc.invalidateQueries({ queryKey: ["gmail-connection"] });
    qc.invalidateQueries({ queryKey: ["settings-overview"] });
  }

  const providers = overview.data?.aiProviders ?? [];
  const selectedProvider = providers.find((p) => p.id === provider);
  const g = gmail.data;

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-lg font-semibold">Settings</h1>
      {overview.error && <p className="text-sm text-destructive">{(overview.error as Error).message}</p>}

      <Section title="AI provider">
        <div className="space-y-3 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Provider</Label>
              <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={provider} onChange={(e) => setProvider(e.target.value as typeof provider)}>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.configured ? "" : "(not configured)"}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Model (optional)</Label>
              <Input placeholder={selectedProvider?.defaultModel ?? ""} value={model} onChange={(e) => setModel(e.target.value)} />
            </div>
          </div>
          {selectedProvider && (
            <div className="flex items-start gap-2">
              <Badge variant={selectedProvider.configured ? "default" : "destructive"}>
                {selectedProvider.configured ? "Configured" : "Not configured"}
              </Badge>
              <span className="text-muted-foreground">{selectedProvider.detail}</span>
            </div>
          )}
          {overview.data?.aiChain && (
            <div className="space-y-1 rounded-md bg-muted/50 p-2 text-xs">
              {[
                ["Primary", overview.data.aiChain.primary],
                ["Automatic fallback", overview.data.aiChain.fallback],
              ].map(([label, p]) => {
                const x = p as typeof overview.data.aiChain.primary;
                return (
                  <div key={label as string} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{label as string}:</span>
                    <span>{x.name} ({x.model})</span>
                    <Badge variant={x.configured ? "default" : "destructive"}>{x.configured ? "Configured" : "Not configured"}</Badge>
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            API keys are stored as server-side secrets (never in the browser). Lovable AI and the Gemini fallback run on the server with no key needed.
          </p>
        </div>
      </Section>

      <Section title="Gmail">
        {gmail.isLoading ? (
          <p className="text-sm text-muted-foreground">Checking…</p>
        ) : !g ? (
          <p className="text-sm text-destructive">{(gmail.error as Error)?.message ?? "Could not load Gmail status."}</p>
        ) : !g.configured ? (
          <div className="space-y-2 text-sm">
            <Badge variant="destructive">Not configured</Badge>
            <p className="text-muted-foreground">No Gmail account is linked to this app yet.</p>
          </div>
        ) : g.connected ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Badge>Connected</Badge>
            <span>
              Sending from: <strong>{g.email ?? "(email unknown)"}</strong>
            </span>
          </div>
        ) : (
          <div className="space-y-1 text-sm">
            <Badge variant="destructive">Error</Badge>
            <p className="text-muted-foreground">{(g as { error?: string }).error ?? "Could not reach Gmail."}</p>
          </div>
        )}
      </Section>

      <Section title="Lead source">
        <div className="space-y-3 text-sm">
          <div className="space-y-1.5">
            <Label>Provider</Label>
            <select className="h-9 w-full max-w-sm rounded-md border bg-background px-2 text-sm" value={source} onChange={(e) => setSource(e.target.value)}>
              {overview.data?.leadSources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.configured ? "" : "(not configured)"}
                </option>
              ))}
            </select>
          </div>
          {overview.data?.leadSources
            .filter((s) => s.id === source)
            .map((s) => (
              <div key={s.id} className="flex items-start gap-2">
                <Badge variant={s.configured ? "default" : "destructive"}>{s.configured ? "Configured" : "Not configured"}</Badge>
                <span className="text-muted-foreground">{s.detail}</span>
              </div>
            ))}
        </div>
      </Section>

      <Button onClick={onSave} disabled={saving || overview.isLoading}>
        {saving ? "Saving…" : "Save settings"}
      </Button>
    </div>
  );
}
