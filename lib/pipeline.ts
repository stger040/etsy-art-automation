import { query } from "./db";
import { getEnvBool } from "./env";
import { runStep, logStepError } from "./logger";
import { pickNextNiche } from "./niches";
import { pickOrientation } from "./orientation";
import { pickMockupStyle } from "./mockupStyle";
import { generateListing, checkImageCompliance } from "./claude";
import { generateImage as recraftGenerateImage } from "./recraft";
import { upscaleImage } from "./replicate";
import { uploadToBlob } from "./blob";
import { createMockup } from "./canva";
import { createDraftDigitalListing, uploadDigitalFile, uploadListingImage } from "./etsy";
import { createAndPublishPodProducts } from "./printify";
import type { ListingTypes, PipelineStatus } from "./types";

async function updateRun(runId: string, fields: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const setClauses = keys.map((key, i) => `${key} = $${i + 2}`).join(", ");
  await query(`update pipeline_runs set ${setClauses}, updated_at = now() where id = $1`, [
    runId,
    ...keys.map((k) => fields[k]),
  ]);
}

async function setStatus(runId: string, status: PipelineStatus): Promise<void> {
  await updateRun(runId, { status });
}

export async function createBatch(requestedCount: number): Promise<string> {
  const [row] = await query<{ id: string }>(
    `insert into pipeline_batches (requested_count) values ($1) returning id`,
    [requestedCount]
  );
  return row.id;
}

export async function finalizeBatch(
  batchId: string,
  counts: { succeeded: number; rejected: number; failed: number }
): Promise<void> {
  const status = counts.failed > 0 ? "completed_with_errors" : "completed";
  await query(
    `update pipeline_batches
     set succeeded_count = $2, rejected_count = $3, failed_count = $4, status = $5, completed_at = now()
     where id = $1`,
    [batchId, counts.succeeded, counts.rejected, counts.failed, status]
  );
}

export type RunOutcome = "completed" | "rejected" | "failed";

/** Runs the full generate -> compliance-check -> publish pipeline for a single design. Never throws. */
export async function processOneRun(batchId: string): Promise<RunOutcome> {
  const niche = await pickNextNiche();
  const orientation = pickOrientation();
  const mockupStyle = pickMockupStyle();

  const [{ id: runId }] = await query<{ id: string }>(
    `insert into pipeline_runs (batch_id, niche_id, status, orientation, mockup_style) values ($1, $2, 'generating_theme', $3, $4) returning id`,
    [batchId, niche.id || null, orientation, mockupStyle]
  );

  const ctx = { runId, batchId };

  // --- a. Theme + listing copy ---
  const listing = await runStep("generate_listing", ctx, () => generateListing(niche, orientation));
  if (!listing) {
    await setStatus(runId, "failed");
    return "failed";
  }
  await updateRun(runId, {
    theme: listing.theme,
    image_prompt: listing.image_prompt,
    etsy_title: listing.digital.etsy_title,
    etsy_tags: listing.digital.etsy_tags,
    etsy_description: listing.digital.etsy_description,
    physical_etsy_title: listing.physical.etsy_title,
    physical_etsy_tags: listing.physical.etsy_tags,
    physical_etsy_description: listing.physical.etsy_description,
    status: "generating_image",
  });

  // --- b. Base image via Recraft ---
  const baseImage = await runStep("recraft_generate_image", ctx, () =>
    recraftGenerateImage(listing.image_prompt, orientation)
  );
  if (!baseImage) {
    await setStatus(runId, "failed");
    return "failed";
  }
  await updateRun(runId, { base_image_url: baseImage.url, status: "compliance_check" });

  // --- e. Claude vision compliance check (fail closed) ---
  // Runs against the small pre-upscale image rather than the final ~4500x6000
  // one: upscaling only changes resolution, not depicted content, so this is
  // an equally valid check, and it avoids sending a multi-megabyte base64
  // payload that trips Claude's request size limit. It also means a rejected
  // design skips the Replicate upscale entirely, saving that cost.
  const compliance = await runStep("compliance_check", ctx, () => checkImageCompliance(baseImage.url));
  if (!compliance || !compliance.approved) {
    await updateRun(runId, {
      status: "rejected",
      compliance_status: "rejected",
      compliance_reason: compliance?.reason ?? "Compliance check could not be completed; rejecting to be safe.",
    });
    return "rejected";
  }
  await updateRun(runId, { compliance_status: "approved", compliance_reason: compliance.reason, status: "upscaling" });

  // --- c. Upscale via Replicate Real-ESRGAN ---
  const upscaled = await runStep("replicate_upscale", ctx, () => upscaleImage(baseImage.url, orientation));
  if (!upscaled) {
    await setStatus(runId, "failed");
    return "failed";
  }
  await updateRun(runId, {
    upscaled_image_url: upscaled.url,
    image_width: upscaled.width,
    image_height: upscaled.height,
    status: "uploading",
  });

  // --- d. Upload final image to Vercel Blob ---
  const blobUrl = await runStep("blob_upload", ctx, () => uploadToBlob(upscaled.url, runId));
  if (!blobUrl) {
    await setStatus(runId, "failed");
    return "failed";
  }
  await updateRun(runId, { blob_url: blobUrl });

  // --- f. Publish: digital (Canva + Etsy) and physical (Printify) branches ---
  const listingTypes: ListingTypes = [];

  if (getEnvBool("PIPELINE_ENABLE_DIGITAL", true)) {
    await setStatus(runId, "publishing_digital");
    const mockup = await runStep("canva_mockup", ctx, () => createMockup(blobUrl, runId, orientation, mockupStyle));
    const listingImageUrl = mockup?.mockupUrl ?? blobUrl;

    const etsyListing = await runStep("etsy_create_draft_listing", ctx, () =>
      createDraftDigitalListing(listing.digital)
    );
    if (etsyListing) {
      await runStep("etsy_upload_digital_file", ctx, () =>
        uploadDigitalFile(etsyListing.listingId, blobUrl, `${listing.theme.replace(/[^a-z0-9]+/gi, "-")}.png`)
      );
      await runStep("etsy_upload_listing_image", ctx, () => uploadListingImage(etsyListing.listingId, listingImageUrl));
      await logStepError({
        runId,
        batchId,
        step: "etsy_ai_disclosure_reminder",
        error:
          "Etsy Open API v3 has no documented field to set the 'made with AI' checkbox. " +
          "A disclosure sentence was added to the listing description automatically, but you must " +
          "manually check that box in the Etsy listing editor before activating this draft.",
      });
      listingTypes.push("digital");
      await updateRun(runId, {
        etsy_listing_id: etsyListing.listingId,
        canva_design_id: mockup?.designId ?? null,
        canva_mockup_url: mockup?.mockupUrl ?? null,
      });
    }
  }

  if (getEnvBool("PIPELINE_ENABLE_PHYSICAL", true)) {
    await setStatus(runId, "publishing_physical");
    const printify = await runStep("printify_create_and_publish", ctx, () =>
      createAndPublishPodProducts(listing.physical, blobUrl, runId, upscaled.width, upscaled.height)
    );
    if (printify) {
      listingTypes.push("physical");
      await updateRun(runId, {
        printify_product_id: printify.productIds.join(","),
        printify_publish_status: "published",
      });
    }
  }

  const outcome: RunOutcome = listingTypes.length > 0 ? "completed" : "failed";
  await updateRun(runId, { listing_types: listingTypes, status: outcome === "completed" ? "completed" : "failed" });
  return outcome;
}
