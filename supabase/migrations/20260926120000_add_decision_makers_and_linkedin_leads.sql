-- DECISION MAKERS
CREATE TABLE public.decision_makers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  job_title text,
  company_name text NOT NULL,
  location text,
  linkedin_url text,
  professional_email text,
  professional_phone text,
  company_website text,
  source_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence integer NOT NULL DEFAULT 0,
  target_service text,
  match_key text NOT NULL,
  imported_lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.decision_makers TO authenticated;
GRANT ALL ON public.decision_makers TO service_role;
ALTER TABLE public.decision_makers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "decision_makers_select_own" ON public.decision_makers FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "decision_makers_insert_own" ON public.decision_makers FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "decision_makers_update_own" ON public.decision_makers FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "decision_makers_delete_own" ON public.decision_makers FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX idx_decision_makers_user_created ON public.decision_makers (user_id, created_at DESC);
CREATE UNIQUE INDEX idx_decision_makers_user_match_key ON public.decision_makers (user_id, match_key);

CREATE TRIGGER decision_makers_set_updated_at BEFORE UPDATE ON public.decision_makers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- LINKEDIN LEADS
CREATE TABLE public.linkedin_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  job_title text,
  company_name text,
  location text,
  headline text,
  linkedin_url text,
  company_url text,
  industry text,
  seniority text,
  professional_email text,
  professional_phone text,
  company_email text,
  company_phone text,
  source_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence integer NOT NULL DEFAULT 0,
  target_service text,
  source_type text NOT NULL DEFAULT 'linkedin_public_search',
  match_key text NOT NULL,
  imported_lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.linkedin_leads TO authenticated;
GRANT ALL ON public.linkedin_leads TO service_role;
ALTER TABLE public.linkedin_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "linkedin_leads_select_own" ON public.linkedin_leads FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "linkedin_leads_insert_own" ON public.linkedin_leads FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "linkedin_leads_update_own" ON public.linkedin_leads FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "linkedin_leads_delete_own" ON public.linkedin_leads FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX idx_linkedin_leads_user_created ON public.linkedin_leads (user_id, created_at DESC);
CREATE UNIQUE INDEX idx_linkedin_leads_user_match_key ON public.linkedin_leads (user_id, match_key);

CREATE TRIGGER linkedin_leads_set_updated_at BEFORE UPDATE ON public.linkedin_leads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
