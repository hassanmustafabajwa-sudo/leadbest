import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({ to: "/auth", search: { redirect: location.href } });
    }
  },
  component: AppLayout,
});

const NAV = [
  { to: "/leads", label: "Leads" },
  { to: "/import", label: "Map Scraper" },
  { to: "/online-search", label: "Online Search" },
  { to: "/decision-makers", label: "Decision Makers" },
  { to: "/linkedin-leads", label: "LinkedIn Leads" },
  { to: "/outreach", label: "Outreach" },
  { to: "/history", label: "History" },
  { to: "/settings", label: "Settings" },
] as const;

function AppLayout() {
  const { user } = useAuth();
  const navigate = useNavigate();

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-12 max-w-7xl items-center gap-6 px-4">
          <span className="text-sm font-semibold tracking-tight">Lead Generation OS</span>
          <nav className="flex items-center gap-1">
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className="rounded px-2.5 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                activeProps={{ className: "rounded px-2.5 py-1 text-sm bg-muted text-foreground font-medium" }}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
            <span>{user?.email}</span>
            <Button size="sm" variant="ghost" onClick={signOut}>
              Log out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
