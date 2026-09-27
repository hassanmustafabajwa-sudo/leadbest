import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isValidEmail, renderTemplate } from "./templates";

// ---------------------------------------------------------------------------
// Selection tracking
// ---------------------------------------------------------------------------

export const markLeadsSelected = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ leadIds: z.array(z.string().uuid()).min(1).max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("leads")
      .update({ outreach_status: "selected" })
      .in("id", data.leadIds)
      .eq("user_id", context.userId)
      .eq("outreach_status", "none");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// AI personalization (small chunks; client loops for progress)
// ---------------------------------------------------------------------------

const PersonalizeInput = z.object({
  leadIds: z.array(z.string().uuid()).min(1).max(3),
  subject: z.string().min(1).max(300),
  body: z.string().min(1).max(10000),
});

export type PersonalizeResult = {
  leadId: string;
  ok: boolean;
  subject?: string;
  body?: string;
  error?: string;
};

export const personalizeEmails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PersonalizeInput.parse(d))
  .handler(async ({ data, context }) => {
    const { personalizeEmailWithAi } = await import("./lead-analysis.server");
    const { isProviderConfigured, AiError } = await import("./ai-provider.server");
    const { loadUserSettings } = await import("./settings.server");
    const settings = await loadUserSettings(context.supabase, context.userId);
    if (!isProviderConfigured(settings.ai_provider) && !isProviderConfigured("gemini")) {
      return {
        error: `AI provider "${settings.ai_provider}" is not configured. Open Settings to fix it.`,
        fatal: true as const,
        results: [] as PersonalizeResult[],
      };
    }
    const { data: leads, error } = await context.supabase
      .from("leads")
      .select("*")
      .in("id", data.leadIds)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);

    const results: PersonalizeResult[] = [];
    for (const lead of leads ?? []) {
      // Resolve template variables first so the AI works from concrete text.
      const baseSubject = renderTemplate(data.subject, lead);
      const baseBody = renderTemplate(data.body, lead);
      try {
        const out = await personalizeEmailWithAi(
          { ...lead, rating: lead.rating === null ? null : Number(lead.rating) },
          baseSubject,
          baseBody,
          settings.ai_provider,
          settings.ai_model,
        );
        results.push({ leadId: lead.id, ok: true, subject: out.subject, body: out.body });
      } catch (e) {
        const msg = e instanceof AiError ? e.message : (e as Error).message;
        results.push({ leadId: lead.id, ok: false, error: msg });
        if (e instanceof AiError && (e.kind === "auth" || e.kind === "config" || e.kind === "payment")) {
          return { error: msg, fatal: true as const, results };
        }
      }
    }
    return { results, fatal: false as const };
  });

// ---------------------------------------------------------------------------
// Queue + send
// ---------------------------------------------------------------------------

const QueueInput = z.object({
  campaignId: z.string().uuid().nullable(),
  newCampaignName: z.string().trim().max(120).nullable(),
  subject: z.string().min(1).max(300),
  body: z.string().min(1).max(10000),
  recipients: z
    .array(
      z.object({
        leadId: z.string().uuid(),
        subject: z.string().min(1).max(300),
        body: z.string().min(1).max(10000),
        personalized: z.boolean(),
      }),
    )
    .min(1)
    .max(500),
});

export type QueueSkipped = { leadId: string; company: string; reason: string };

export const queueOutreach = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => QueueInput.parse(d))
  .handler(async ({ data, context }) => {
    const { getGmailStatus } = await import("./gmail.server");
    const gmail = await getGmailStatus(context.userId);
    if (!gmail.configured) {
      return { ok: false as const, error: `Gmail is not configured (missing ${gmail.missing.join(", ")}).` };
    }
    if (!gmail.connected) {
      return { ok: false as const, error: "No Gmail account is connected. Connect Gmail in Settings first." };
    }

    let campaignId = data.campaignId;
    if (!campaignId && data.newCampaignName) {
      const { data: c, error } = await context.supabase
        .from("campaigns")
        .insert({ user_id: context.userId, name: data.newCampaignName, subject: data.subject, body: data.body })
        .select("id")
        .single();
      if (error) return { ok: false as const, error: `Could not create campaign: ${error.message}` };
      campaignId = c.id;
    }

    const leadIds = data.recipients.map((r) => r.leadId);
    const { data: leads, error: leadErr } = await context.supabase
      .from("leads")
      .select("id, company_name, email")
      .in("id", leadIds)
      .eq("user_id", context.userId);
    if (leadErr) return { ok: false as const, error: leadErr.message };
    const leadMap = new Map((leads ?? []).map((l) => [l.id, l]));

    // Duplicate protection: same campaign already sent/queued to this lead,
    // or (no campaign) the identical subject already sent to this lead.
    let dupQuery = context.supabase
      .from("outreach_messages")
      .select("lead_id, subject, status, campaign_id")
      .eq("user_id", context.userId)
      .in("lead_id", leadIds)
      .in("status", ["queued", "sent"]);
    if (campaignId) dupQuery = dupQuery.eq("campaign_id", campaignId);
    const { data: existing } = await dupQuery;

    const skipped: QueueSkipped[] = [];
    const rows: Array<{
      user_id: string;
      lead_id: string;
      campaign_id: string | null;
      subject: string;
      body: string;
      personalized_body: string | null;
      recipient_email: string;
      status: string;
    }> = [];

    for (const r of data.recipients) {
      const lead = leadMap.get(r.leadId);
      if (!lead) {
        skipped.push({ leadId: r.leadId, company: "(unknown)", reason: "Lead not found" });
        continue;
      }
      if (!isValidEmail(lead.email)) {
        skipped.push({ leadId: r.leadId, company: lead.company_name, reason: "No valid email address" });
        continue;
      }
      const dup = (existing ?? []).find(
        (m) => m.lead_id === r.leadId && (campaignId ? true : m.subject === r.subject),
      );
      if (dup) {
        skipped.push({
          leadId: r.leadId,
          company: lead.company_name,
          reason: campaignId ? `Already ${dup.status} in this campaign` : `Same subject already ${dup.status}`,
        });
        continue;
      }
      rows.push({
        user_id: context.userId,
        lead_id: r.leadId,
        campaign_id: campaignId,
        subject: r.subject,
        body: renderTemplate(data.body, {}),
        personalized_body: r.body,
        recipient_email: lead.email.trim(),
        status: "queued",
      });
    }

    let queued: Array<{ messageId: string; leadId: string }> = [];
    if (rows.length) {
      const { data: inserted, error } = await context.supabase
        .from("outreach_messages")
        .insert(rows)
        .select("id, lead_id");
      if (error) return { ok: false as const, error: `Could not queue messages: ${error.message}` };
      queued = (inserted ?? []).map((m) => ({ messageId: m.id, leadId: m.lead_id }));
      await context.supabase
        .from("leads")
        .update({ outreach_status: "draft" })
        .in("id", queued.map((q) => q.leadId))
        .eq("user_id", context.userId);
    }
    return { ok: true as const, campaignId, queued, skipped };
  });

export type SendResult = { messageId: string; leadId: string; ok: boolean; error?: string; gmailId?: string };

export const processOutreachQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ messageIds: z.array(z.string().uuid()).min(1).max(5) }).parse(d))
  .handler(async ({ data, context }) => {
    const { sendGmailMessage, GmailError } = await import("./gmail.server");
    const { data: messages, error } = await context.supabase
      .from("outreach_messages")
      .select("id, lead_id, subject, body, personalized_body, recipient_email, status")
      .in("id", data.messageIds)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);

    const results: SendResult[] = [];
    let fatal: string | null = null;

    for (const m of messages ?? []) {
      if (m.status !== "queued") {
        results.push({ messageId: m.id, leadId: m.lead_id, ok: false, error: `Skipped: status is ${m.status}` });
        continue;
      }
      if (!isValidEmail(m.recipient_email)) {
        await context.supabase
          .from("outreach_messages")
          .update({ status: "failed", error_message: "No valid recipient email" })
          .eq("id", m.id);
        results.push({ messageId: m.id, leadId: m.lead_id, ok: false, error: "No valid recipient email" });
        continue;
      }
      try {
        const sent = await sendGmailMessage(context.userId, {
          to: m.recipient_email,
          subject: m.subject,
          body: m.personalized_body ?? m.body,
        });
        await context.supabase
          .from("outreach_messages")
          .update({ status: "sent", sent_at: new Date().toISOString(), gmail_message_id: sent.id, error_message: null })
          .eq("id", m.id);
        await context.supabase.from("leads").update({ outreach_status: "sent" }).eq("id", m.lead_id);
        results.push({ messageId: m.id, leadId: m.lead_id, ok: true, gmailId: sent.id });
      } catch (e) {
        const msg = e instanceof GmailError ? e.message : (e as Error).message;
        await context.supabase
          .from("outreach_messages")
          .update({ status: "failed", error_message: msg })
          .eq("id", m.id);
        await context.supabase.from("leads").update({ outreach_status: "failed" }).eq("id", m.lead_id);
        results.push({ messageId: m.id, leadId: m.lead_id, ok: false, error: msg });
        if (e instanceof GmailError && ["reauth", "config", "not_connected", "rate_limit"].includes(e.kind)) {
          fatal = msg;
          break;
        }
      }
      // Small pacing delay between sends.
      await new Promise((r) => setTimeout(r, 400));
    }

    if (fatal) {
      // Anything left queued in this chunk stays queued for a later retry; mark
      // the remaining ids so the client can report them.
      const done = new Set(results.map((r) => r.messageId));
      for (const id of data.messageIds) {
        if (!done.has(id)) results.push({ messageId: id, leadId: "", ok: false, error: "Not attempted (sending stopped)" });
      }
    }
    return { results, fatal };
  });
