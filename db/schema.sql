-- Etsy art automation pipeline schema
-- Run via `npm run db:migrate` (executes this file against DATABASE_URL).

create extension if not exists pgcrypto;

-- Persists OAuth access/refresh tokens for providers whose refresh tokens
-- rotate on use (Etsy, Canva). Seeded on first use from the corresponding
-- env vars, then self-updating — this avoids needing to redeploy env vars
-- every time a refresh token rotates.
create table if not exists oauth_tokens (
  provider text primary key,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

-- Rotating pool of art niches/themes the pipeline draws from.
create table if not exists niches (
  id serial primary key,
  name text not null unique,
  description text not null default '',
  prompt_style text not null default '',
  active boolean not null default true,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

-- One row per cron invocation, grouping the listings it generated.
create table if not exists pipeline_batches (
  id uuid primary key default gen_random_uuid(),
  requested_count integer not null,
  succeeded_count integer not null default 0,
  rejected_count integer not null default 0,
  failed_count integer not null default 0,
  status text not null default 'running'
    check (status in ('running', 'completed', 'completed_with_errors')),
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

-- One row per generated design/listing. This is the primary audit log.
create table if not exists pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references pipeline_batches(id) on delete set null,
  niche_id integer references niches(id),

  -- Claude-generated content
  theme text,
  image_prompt text,
  etsy_title text,
  etsy_tags text[],
  etsy_description text,

  -- Image pipeline
  base_image_url text,
  upscaled_image_url text,
  blob_url text,
  image_width integer,
  image_height integer,

  -- Compliance check
  compliance_status text not null default 'pending'
    check (compliance_status in ('pending', 'approved', 'rejected')),
  compliance_reason text,

  -- Publishing
  listing_types text[] not null default '{}', -- subset of {digital, physical}
  etsy_listing_id text,
  canva_design_id text,
  canva_mockup_url text,
  printify_product_id text,
  printify_publish_status text,

  -- Overall lifecycle state
  status text not null default 'queued'
    check (status in (
      'queued',
      'generating_theme',
      'generating_image',
      'upscaling',
      'uploading',
      'compliance_check',
      'rejected',
      'publishing_digital',
      'publishing_physical',
      'completed',
      'failed'
    )),
  error_message text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_pipeline_runs_batch_id on pipeline_runs(batch_id);
create index if not exists idx_pipeline_runs_status on pipeline_runs(status);
create index if not exists idx_pipeline_runs_created_at on pipeline_runs(created_at desc);

-- Per-step error log. A single run can accumulate several (e.g. Printify
-- fails but Etsy digital publish still succeeds), so this is 1:many.
create table if not exists pipeline_step_errors (
  id serial primary key,
  run_id uuid references pipeline_runs(id) on delete cascade,
  batch_id uuid references pipeline_batches(id) on delete cascade,
  step text not null,
  error_message text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_pipeline_step_errors_run_id on pipeline_step_errors(run_id);

-- Seed a starter niche list. Edit/add rows directly in Postgres to configure
-- what the pipeline rotates through; `active=false` rows are skipped.
insert into niches (name, description, prompt_style) values
  ('Botanical line art', 'Minimalist single-line botanical illustrations', 'fine continuous-line art, botanical, minimalist, neutral background'),
  ('Abstract geometric', 'Bold abstract geometric shapes and color blocking', 'bold abstract geometric composition, modern color blocking'),
  ('Vintage travel poster', 'Retro mid-century travel poster art', 'vintage mid-century travel poster style, muted retro palette'),
  ('Celestial/astrology', 'Moon phases, constellations, celestial motifs', 'celestial line art, moon phases, constellations, gold and navy palette'),
  ('Coastal watercolor', 'Soft watercolor coastal and nautical scenes', 'loose watercolor painting, coastal scene, soft pastel palette'),
  ('Cottagecore floral', 'Whimsical cottagecore floral patterns', 'whimsical cottagecore floral illustration, soft warm palette')
on conflict (name) do nothing;
