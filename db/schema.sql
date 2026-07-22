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

-- Tracks whether a design that finished generation + compliance approval but
-- failed to auto-publish anywhere has been handled through the manual
-- fallback flow (/manual-queue) yet. Only meaningful when status='failed'
-- and blob_url is set (i.e. the asset exists, publishing is what failed).
alter table pipeline_runs add column if not exists manual_review_status text not null default 'pending'
  check (manual_review_status in ('pending', 'published', 'skipped'));

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
--
-- Picked from actual Etsy search-volume/trend data (abstract ~90k/mo searches,
-- botanical ~40k/mo, boho/southwestern/celestial as named 2026 trend picks) —
-- see the design rationale in the project README. All of these are
-- deliberately text-free (AI image models render legible text unreliably,
-- and Etsy's popular quote-print niche depends on it) and apparel-friendly,
-- so the same generated art works for both the digital listing and Printify
-- posters/canvases/shirts.
insert into niches (name, description, prompt_style) values
  ('Abstract geometric', 'Bold abstract geometric shapes and color blocking', 'bold abstract geometric composition, modern color blocking, no text'),
  ('Neutral abstract shapes', 'Soft organic abstract shapes in neutral tones for boho/minimalist decor', 'soft organic abstract shapes, neutral beige/terracotta/cream palette, boho minimalist, no text'),
  ('Botanical line art', 'Minimalist single-line botanical illustrations', 'fine continuous-line art, botanical, minimalist, neutral background, no text'),
  ('Modern botanical black and white', 'High-contrast black and white botanical illustration', 'high-contrast black and white botanical illustration, bold modern linework, no text'),
  ('Boho mountain landscape', 'Minimalist boho-style mountain and desert landscape', 'minimalist boho mountain landscape, sun motif, muted earth-tone palette, no text'),
  ('Southwestern desert illustration', 'Southwestern desert motifs — cacti, terracotta, sun', 'southwestern desert illustration, cacti and mesa shapes, terracotta and sand palette, no text'),
  ('Celestial minimalist line art', 'Moon phases and constellations in a minimalist line-art style', 'minimalist celestial line art, moon phases, constellations, gold and neutral palette, no text'),
  ('Coastal minimalist line art', 'Coastal and nautical motifs in a clean minimalist line-art style', 'minimalist coastal line art, waves and shoreline, soft blue and sand palette, no text')
on conflict (name) do nothing;
