# Etsy Art Automation

Automated pipeline: a daily Vercel Cron job generates new wall-art designs and
listing copy with Claude, renders the art with Recraft, upscales it with
Replicate's Real-ESRGAN, runs an AI compliance check, then publishes a digital
download listing to Etsy (via Canva mockups) and physical poster/canvas
products (via Printify's native Etsy integration).

This project deliberately does **not** touch Etsy shop creation, Etsy OAuth
app registration, Printify↔Etsy store connection, or any customer messaging —
those are manual one-time steps you do yourself.

## Architecture

```
Vercel Cron (daily) → /api/pipeline/run
  for each of LISTINGS_PER_DAY designs:
    a. Claude          → theme + image prompt + Etsy title/tags/description
    b. Recraft         → base image
    c. Replicate       → upscale to >=4500x6000
    d. Vercel Blob     → durable image URL
    e. Claude (vision) → compliance check (IP/logos/public figures) — fail closed
    f. if approved:
         digital:  Canva autofill/export mockup → Etsy draft listing (type=download)
         physical: Printify product (poster + canvas) → publish via Printify's Etsy integration
    g. every step's result/error is logged to Postgres (pipeline_runs, pipeline_step_errors)

/api/pipeline/status → JSON run history, also feeds /dashboard
```

Every external call is wrapped so a single failure (e.g. Printify down) is
logged and skipped rather than crashing the whole run — see `lib/logger.ts`'s
`runStep`.

## Setup

### 1. Database (Neon Postgres)

Create a Neon Postgres database (either directly at neon.tech, or via
Vercel's Storage tab → Marketplace Database Providers → Neon, which wires
`DATABASE_URL` into your Vercel project automatically).

```bash
cp .env.example .env   # fill in DATABASE_URL at minimum
npm install
npm run db:migrate     # applies db/schema.sql, seeds starter niches
```

Edit the `niches` table directly in Postgres to configure what the pipeline
rotates through (`npm run seed:niches` lists/upserts rows).

### 2. Vercel project

```bash
npm i -g vercel   # if you don't already have it
vercel link       # connect this directory to a Vercel Pro project/team
```

Then in the Vercel dashboard for the project, set every env var listed below
(Project Settings → Environment Variables), and connect the GitHub repo
(Project Settings → Git) for auto-deploy on push. `vercel.json` already
defines the cron job; edit its `schedule` field directly to change cadence
(Vercel Cron does not support env-var-driven schedules).

### 3. External API accounts

For each of these, you provide the resulting API key/token as a Vercel env
var — this project does not automate account/app creation:

- **Anthropic (Claude)** — API key from console.anthropic.com.
- **Recraft** — API key from your Recraft account.
- **Replicate** — API token from replicate.com.
- **Canva Connect** — create a Connect API integration, complete the OAuth
  consent flow once to get a refresh token, and have a brand template ready
  for the mockup (`CANVA_MOCKUP_TEMPLATE_ID`). Confirm its autofill image
  field name matches `CANVA_IMAGE_FIELD_NAME`.
- **Etsy Open API v3** — register an app, complete OAuth once yourself to get
  an access/refresh token pair. Refresh tokens rotate on every use; this app
  persists the current pair in the `oauth_tokens` Postgres table after first
  use, so you only need to seed the env vars once.
- **Printify** — personal access token, and your shop must already have its
  native Etsy sales channel connected (done by you in the Printify dashboard).

### 4. Test each integration in isolation

Before wiring the full chain, run each of these against your real keys:

```bash
npm run test:claude      # theme + listing generation (pass an image URL to also test compliance check)
npm run test:recraft     # base image generation
npm run test:replicate   # upscaling (pass a source image URL, or it uses a placeholder)
npm run test:blob        # Vercel Blob upload
npm run test:canva       # autofill + export a real mockup design
npm run test:etsy        # creates a REAL draft listing (never activated) — pass --full to also test file/image upload
npm run test:printify    # creates + PUBLISHES real Printify products — clean these up after testing
```

The Etsy and Printify scripts have real side effects (draft listing / live
product creation) — read the console warnings they print before running them.

### 5. Deploy

Push to the `stger040/etsy-art-automation` GitHub repo on the branch Vercel
is tracking (or `main`), and Vercel will build and deploy automatically. Once
deployed, manually trigger a run to confirm the full chain end-to-end:

```bash
curl "https://<your-deployment>/api/pipeline/run?secret=$CRON_SECRET"
```

Then check `/dashboard` for the result.

## Etsy AI-disclosure caveat

Etsy's "made with AI" checkbox is a listing-editor-only UI toggle — there is
no documented Open API v3 field to set it programmatically (see
[etsy/open-api#1269](https://github.com/etsy/open-api/discussions/1269) and
[#1340](https://github.com/etsy/open-api/discussions/1340), both still open).
To stay compliant without silently lying about this:

- Every digital listing description gets an explicit AI-disclosure sentence
  appended automatically (satisfies the textual disclosure requirement).
- Digital listings are created as **drafts only** — this pipeline never
  activates them. Before you activate a draft, manually check the "made with
  AI" box in the Etsy listing editor.
- Every run also logs a `pipeline_step_errors` reminder row for this, so it's
  visible in the dashboard error column every time.

If Etsy later documents a real API field for this, swap it into
`withAiDisclosure()` / `createDraftDigitalListing()` in `lib/etsy.ts`.

## Known unknowns worth double-checking live

A few third-party API details in this codebase are based on documentation
that wasn't directly fetchable while building this (some doc sites 403
non-browser requests) — the isolated test scripts above are exactly how to
confirm them before relying on the full pipeline:

- **Recraft** `size` parameter enum (`lib/recraft.ts`, `RECRAFT_SIZE` env var) —
  confirm against your Recraft dashboard/API reference.
- **Replicate** model version pinning (`REPLICATE_MODEL_VERSION` env var,
  optional) — recommended to pin once you've confirmed behavior via
  `npm run test:replicate`.
- **Printify** variant pricing — every catalog variant is enabled at a flat
  `PRINTIFY_DEFAULT_PRICE_CENTS`; adjust per-variant pricing in
  `lib/printify.ts` if you want size-based pricing.

## Environment variables

See `.env.example` for the full list with inline notes. Summary of every key
you need to set in Vercel:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string |
| `LISTINGS_PER_DAY` | How many designs to generate per cron run (default 1) |
| `CRON_SECRET` | Shared secret required to call `/api/pipeline/run` |
| `ANTHROPIC_API_KEY` | Claude API |
| `CLAUDE_MODEL` | Defaults to `claude-sonnet-4-6` |
| `RECRAFT_API_KEY` | Recraft image generation |
| `RECRAFT_STYLE`, `RECRAFT_SIZE` | Optional overrides |
| `REPLICATE_API_TOKEN` | Replicate upscaling |
| `REPLICATE_MODEL`, `REPLICATE_MODEL_VERSION` | Optional overrides |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob |
| `CANVA_CLIENT_ID`, `CANVA_CLIENT_SECRET`, `CANVA_REFRESH_TOKEN` | Canva Connect OAuth |
| `CANVA_MOCKUP_TEMPLATE_ID` | Brand template to autofill |
| `CANVA_IMAGE_FIELD_NAME` | Template's autofill image field name (default `image`) |
| `ETSY_API_KEY` | Etsy app keystring (OAuth client id) |
| `ETSY_ACCESS_TOKEN`, `ETSY_REFRESH_TOKEN` | Seed OAuth tokens (self-refreshing after) |
| `ETSY_SHOP_ID` | Your Etsy shop id |
| `ETSY_TAXONOMY_ID` | Category id for digital listings |
| `ETSY_DIGITAL_PRICE` | Digital listing price (default 8.00) |
| `PRINTIFY_API_TOKEN` | Printify personal access token |
| `PRINTIFY_SHOP_ID` | Printify shop id (connected to Etsy) |
| `PRINTIFY_POSTER_BLUEPRINT_ID`, `PRINTIFY_POSTER_PRINT_PROVIDER_ID` | Poster product catalog IDs |
| `PRINTIFY_CANVAS_BLUEPRINT_ID`, `PRINTIFY_CANVAS_PRINT_PROVIDER_ID` | Canvas product catalog IDs |
| `PRINTIFY_DEFAULT_PRICE_CENTS` | Flat retail price applied to all variants |

## Notes

- Pinned to Next.js 14.2.35 (latest 14.x patch) as requested. `npm audit`
  still flags a few Next 16-only fixes (image-optimizer DoS, Pages Router
  i18n middleware bypass, WS-upgrade SSRF) — none apply here since this app
  doesn't use `next/image`, i18n routing, or middleware WebSocket upgrades.
- `maxDuration` on the run route is set to 800s, which requires Fluid Compute
  (on by default for new Vercel Pro projects). If your project predates that,
  lower it and keep `LISTINGS_PER_DAY` small.
