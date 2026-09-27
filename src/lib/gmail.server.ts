// Gmail sending through the linked Gmail connection (one shared sender account).
// All calls are server-side; credentials come from server env vars and are
// never returned or logged.

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";

export class GmailError extends Error {
  constructor(
    message: string,
    public readonly kind: "config" | "not_connected" | "reauth" | "rejected" | "rate_limit" | "upstream",
    public readonly status?: number,
  ) {
    super(message);
    this.name = "GmailError";
  }
}

function creds() {
  return { lovable: process.env["LOVABLE_API_KEY"], gmail: process.env["GOOGLE_MAIL_API_KEY"] };
}

export function isGmailConfigured(): { configured: boolean; missing: string[] } {
  const c = creds();
  const missing: string[] = [];
  if (!c.lovable) missing.push("LOVABLE_API_KEY");
  if (!c.gmail) missing.push("GOOGLE_MAIL_API_KEY");
  return { configured: missing.length === 0, missing };
}

export function callbackUrl(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/public/gmail/callback`;
}

// Legacy per-user OAuth entry points: the app now uses a shared connection.
export function buildAuthUrl(_userId: string, _origin: string): string {
  throw new GmailError("Gmail is connected at the project level; no per-user sign-in is needed.", "config");
}
export async function completeOAuthCallback(_c: string, _s: string, _o: string): Promise<{ email: string }> {
  throw new GmailError("Gmail is connected at the project level; no per-user sign-in is needed.", "config");
}

async function gmailFetch(path: string, init?: RequestInit): Promise<Response> {
  const c = creds();
  if (!c.lovable || !c.gmail) {
    throw new GmailError(`Gmail is not configured (missing ${isGmailConfigured().missing.join(", ")}).`, "config");
  }
  return fetch(`${GATEWAY_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${c.lovable}`,
      "X-Connection-Api-Key": c.gmail,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

async function toError(res: Response, action: string): Promise<GmailError> {
  const text = await res.text();
  console.error(`[gmail] ${action} failed [${res.status}]: ${text.slice(0, 500)}`);
  let msg = text.slice(0, 300);
  try {
    msg = JSON.parse(text)?.error?.message ?? msg;
  } catch {
    /* ignore */
  }
  if (res.status === 401) return new GmailError("Gmail authorization expired. Reconnect Gmail in Lovable connectors.", "reauth", 401);
  if (res.status === 403) return new GmailError(`Gmail refused: ${msg}`, "rejected", 403);
  if (res.status === 429) return new GmailError(`Gmail rate limit reached: ${msg}`, "rate_limit", 429);
  if (res.status === 400) return new GmailError(`Gmail rejected the request: ${msg}`, "rejected", 400);
  return new GmailError(`Gmail error (${res.status}): ${msg}`, "upstream", res.status);
}

let cachedEmail: string | null = null;
async function getProfileEmail(): Promise<string> {
  if (cachedEmail) return cachedEmail;
  const res = await gmailFetch("/users/me/profile");
  if (!res.ok) throw await toError(res, "profile");
  const json = (await res.json()) as { emailAddress?: string };
  cachedEmail = json.emailAddress ?? "";
  return cachedEmail;
}

export type GmailStatus = {
  configured: boolean;
  missing: string[];
  connected: boolean;
  email: string | null;
  connectedAt: string | null;
  error?: string;
};

export async function getGmailStatus(_userId: string): Promise<GmailStatus> {
  const cfg = isGmailConfigured();
  if (!cfg.configured) return { configured: false, missing: cfg.missing, connected: false, email: null, connectedAt: null };
  try {
    const email = await getProfileEmail();
    return { configured: true, missing: [], connected: true, email, connectedAt: null };
  } catch (e) {
    return { configured: true, missing: [], connected: false, email: null, connectedAt: null, error: (e as Error).message };
  }
}

export async function disconnectGmail(_userId: string): Promise<void> {
  throw new GmailError("Gmail is managed in Lovable connectors; disconnect it there.", "config");
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const b64url = (s: string) => b64(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const header = (v: string) => (/^[\x00-\x7F]*$/.test(v) ? v : `=?UTF-8?B?${b64(v)}?=`);

export async function sendGmailMessage(
  _userId: string,
  args: { to: string; subject: string; body: string },
): Promise<{ id: string; threadId?: string }> {
  const from = await getProfileEmail();
  const raw = b64url(
    [
      from ? `From: ${from}` : "",
      `To: ${args.to}`,
      `Subject: ${header(args.subject)}`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      args.body,
    ]
      .filter((l, i) => i > 0 || l)
      .join("\r\n"),
  );
  const res = await gmailFetch("/users/me/messages/send", { method: "POST", body: JSON.stringify({ raw }) });
  if (!res.ok) throw await toError(res, "send");
  return (await res.json()) as { id: string; threadId?: string };
}
