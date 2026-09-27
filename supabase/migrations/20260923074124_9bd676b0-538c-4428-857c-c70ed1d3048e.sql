CREATE TABLE public.search_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  niche text NOT NULL,
  location text NOT NULL,
  min_leads integer,
  max_leads integer,
  status text NOT NULL DEFAULT 'running',
  rounds integer NOT NULL DEFAULT 0,
  result_count integer NOT NULL DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.search_runs TO authenticated;
GRANT ALL ON public.search_runs TO service_role;
ALTER TABLE public.search_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own search runs" ON public.search_runs FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_search_runs_user_created ON public.search_runs (user_id, created_at DESC);

CREATE TABLE public.search_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.search_runs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_name text NOT NULL,
  match_key text NOT NULL,
  category text,
  city text,
  country text,
  address text,
  phone text,
  email text,
  website text,
  maps_url text,
  rating numeric(2,1),
  review_count integer,
  description text,
  social_links jsonb NOT NULL DEFAULT '{}'::jsonb,
  website_status text NOT NULL DEFAULT 'uncertain',
  website_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  quality_score integer NOT NULL DEFAULT 0,
  imported_lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, match_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.search_results TO authenticated;
GRANT ALL ON public.search_results TO service_role;
ALTER TABLE public.search_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own search results" ON public.search_results FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_search_results_run ON public.search_results (run_id, quality_score DESC);
CREATE INDEX idx_search_results_user ON public.search_results (user_id, created_at DESC);

CREATE TRIGGER search_runs_set_updated_at BEFORE UPDATE ON public.search_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER search_results_set_updated_at BEFORE UPDATE ON public.search_results
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();