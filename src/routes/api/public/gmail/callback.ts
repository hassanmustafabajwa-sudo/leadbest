import { createFileRoute } from "@tanstack/react-router";

function page(title: string, message: string, ok: boolean): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f6f6f4;color:#1a1a1a}
.card{max-width:420px;padding:32px;background:#fff;border:1px solid #e3e3df;border-radius:10px}
h1{font-size:18px;margin:0 0 8px}p{margin:0 0 16px;color:#555;line-height:1.5}a{color:#1a56db}</style></head>
<body><div class="card"><h1>${title}</h1><p>${message}</p>
<p><a href="/settings">Back to Settings</a></p>
<script>try{if(window.opener){window.opener.postMessage({type:"gmail-oauth",ok:${ok}},window.location.origin);}}catch(e){}</script>
</div></body></html>`;
  return new Response(html, { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8" } });
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export const Route = createFileRoute("/api/public/gmail/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
        const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
        const origin = `${proto}://${host}`;

        const error = url.searchParams.get("error");
        if (error) {
          return page("Gmail not connected", `Google returned: ${esc(error)}. You can close this tab and try again.`, false);
        }
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code || !state) return page("Gmail not connected", "Missing authorization code.", false);

        const { completeOAuthCallback, GmailError } = await import("@/lib/gmail.server");
        try {
          const { email } = await completeOAuthCallback(code, state, origin);
          return page("Gmail connected", `${esc(email)} is now connected. You can close this tab.`, true);
        } catch (e) {
          const msg = e instanceof GmailError ? e.message : "Unexpected error while connecting Gmail.";
          console.error("[gmail] callback failed", e);
          return page("Gmail not connected", esc(msg), false);
        }
      },
    },
  },
});
