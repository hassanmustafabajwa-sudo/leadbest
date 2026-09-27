import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function originFromRequest(fallback?: string): string {
  const req = getRequest();
  const url = req ? new URL(req.url) : null;
  // Behind the hosting proxy the request URL may be internal; prefer forwarded headers.
  const proto = req?.headers.get("x-forwarded-proto");
  const host = req?.headers.get("x-forwarded-host") ?? req?.headers.get("host");
  if (host) return `${proto ?? url?.protocol.replace(":", "") ?? "https"}://${host}`;
  return fallback ?? url?.origin ?? "";
}

export const getGmailConnection = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ origin: z.string().url().optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { getGmailStatus, callbackUrl } = await import("./gmail.server");
    const status = await getGmailStatus(context.userId);
    return { ...status, redirectUri: callbackUrl(data.origin ?? originFromRequest()) };
  });

export const startGmailConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ origin: z.string().url() }).parse(d))
  .handler(async ({ data, context }) => {
    const { buildAuthUrl, GmailError } = await import("./gmail.server");
    try {
      return { ok: true as const, url: buildAuthUrl(context.userId, data.origin) };
    } catch (e) {
      if (e instanceof GmailError) return { ok: false as const, error: e.message, kind: e.kind };
      throw e;
    }
  });

export const disconnectGmailAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { disconnectGmail } = await import("./gmail.server");
    await disconnectGmail(context.userId);
    return { ok: true };
  });
