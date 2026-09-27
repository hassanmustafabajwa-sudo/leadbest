-- updated_at helper
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- LEADS
CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  company_name text NOT NULL,
  first_name text,
  last_name text,
  industry text,
  address text,
  city text,
  country text,
  website text,
  email text,
  phone text,
  maps_url text,
  rating numeric(3,2),
  review_count integer,
  description text,
  source text NOT NULL DEFAULT 'manual',
  source_id text,
  ai_score integer,
  ai_analysis jsonb,
  recommended_service text,
  qualification_status text NOT NULL DEFAULT 'new',
  outreach_status text NOT NULL DEFAULT 'none',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "leads_select_own" ON public.leads FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "leads_insert_own" ON public.leads FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "leads_update_own" ON public.leads FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "leads_delete_own" ON public.leads FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX leads_user_created_idx ON public.leads (user_id, created_at DESC);
CREATE INDEX leads_user_status_idx ON public.leads (user_id, qualification_status, outreach_status);
CREATE INDEX leads_user_score_idx ON public.leads (user_id, ai_score DESC NULLS LAST);
CREATE UNIQUE INDEX leads_user_source_id_uniq ON public.leads (user_id, source, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX leads_user_website_idx ON public.leads (user_id, lower(website)) WHERE website IS NOT NULL;
CREATE TRIGGER leads_set_updated_at BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- CAMPAIGNS
CREATE TABLE public.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  subject text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaigns TO authenticated;
GRANT ALL ON public.campaigns TO service_role;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "campaigns_select_own" ON public.campaigns FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "campaigns_insert_own" ON public.campaigns FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "campaigns_update_own" ON public.campaigns FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "campaigns_delete_own" ON public.campaigns FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX campaigns_user_idx ON public.campaigns (user_id, created_at DESC);

-- OUTREACH MESSAGES
CREATE TABLE public.outreach_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  subject text NOT NULL,
  body text NOT NULL,
  personalized_body text,
  recipient_email text,
  status text NOT NULL DEFAULT 'draft',
  sent_at timestamptz,
  error_message text,
  gmail_message_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.outreach_messages TO authenticated;
GRANT ALL ON public.outreach_messages TO service_role;
ALTER TABLE public.outreach_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "outreach_select_own" ON public.outreach_messages FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "outreach_insert_own" ON public.outreach_messages FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "outreach_update_own" ON public.outreach_messages FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "outreach_delete_own" ON public.outreach_messages FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX outreach_user_lead_idx ON public.outreach_messages (user_id, lead_id, created_at DESC);
CREATE INDEX outreach_campaign_idx ON public.outreach_messages (campaign_id);

-- USER SETTINGS (non-secret config only)
CREATE TABLE public.user_settings (
  user_id uuid PRIMARY KEY,
  ai_provider text NOT NULL DEFAULT 'lovable',
  ai_model text,
  lead_source text NOT NULL DEFAULT 'google_maps',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_settings TO authenticated;
GRANT ALL ON public.user_settings TO service_role;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings_select_own" ON public.user_settings FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "settings_insert_own" ON public.user_settings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "settings_update_own" ON public.user_settings FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER settings_set_updated_at BEFORE UPDATE ON public.user_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- PER-USER GMAIL CONNECTION (server-only; encrypted key, never readable from the browser)
CREATE TABLE public.app_user_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  connector_id text NOT NULL,
  connection_key_ciphertext text NOT NULL,
  account_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, connector_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_user_connections TO service_role;
ALTER TABLE public.app_user_connections ENABLE ROW LEVEL SECURITY;