export type Niche = {
  id: number;
  name: string;
  description: string;
  prompt_style: string;
  active: boolean;
  last_used_at: string | null;
  created_at: string;
};

export type ListingTypes = Array<"digital" | "physical">;

export type PipelineStatus =
  | "queued"
  | "generating_theme"
  | "generating_image"
  | "upscaling"
  | "uploading"
  | "compliance_check"
  | "rejected"
  | "publishing_digital"
  | "publishing_physical"
  | "completed"
  | "failed";

export type PipelineRun = {
  id: string;
  batch_id: string | null;
  niche_id: number | null;
  theme: string | null;
  image_prompt: string | null;
  etsy_title: string | null;
  etsy_tags: string[] | null;
  etsy_description: string | null;
  base_image_url: string | null;
  upscaled_image_url: string | null;
  blob_url: string | null;
  image_width: number | null;
  image_height: number | null;
  compliance_status: "pending" | "approved" | "rejected";
  compliance_reason: string | null;
  listing_types: ListingTypes;
  etsy_listing_id: string | null;
  canva_design_id: string | null;
  canva_mockup_url: string | null;
  printify_product_id: string | null;
  printify_publish_status: string | null;
  status: PipelineStatus;
  error_message: string | null;
  manual_review_status: "pending" | "published" | "skipped";
  created_at: string;
  updated_at: string;
};

export type PipelineBatch = {
  id: string;
  requested_count: number;
  succeeded_count: number;
  rejected_count: number;
  failed_count: number;
  status: "running" | "completed" | "completed_with_errors";
  started_at: string;
  completed_at: string | null;
};

/** Structured output Claude produces per design/listing. */
export type GeneratedListing = {
  theme: string;
  image_prompt: string;
  etsy_title: string;
  etsy_tags: string[];
  etsy_description: string;
};

export type ComplianceResult = {
  approved: boolean;
  reason: string;
};
