ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS social_links jsonb,
  ADD COLUMN IF NOT EXISTS contact_page_url text,
  ADD COLUMN IF NOT EXISTS enrichment_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS enrichment_error text,
  ADD COLUMN IF NOT EXISTS enriched_at timestamptz;