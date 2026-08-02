import { getEnv, requireEnv } from "./env";
import type { ComplianceResult, GeneratedListing, ListingCopy, Niche } from "./types";
import type { Orientation } from "./orientation";

const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TITLE_LENGTH = 140;
const MAX_TAG_LENGTH = 20;
const TAG_COUNT = 13;
// Recraft's API rejects prompts over 1000 chars; stay under that with margin.
const MAX_IMAGE_PROMPT_LENGTH = 900;

function model(): string {
  return getEnv("CLAUDE_MODEL", "claude-sonnet-4-6");
}

async function anthropicMessages(body: Record<string, unknown>) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": requireEnv("ANTHROPIC_API_KEY"),
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Claude API error ${res.status}: ${text.slice(0, 500)}`);
  }

  return res.json() as Promise<{
    content: Array<
      | { type: "text"; text: string }
      | { type: "tool_use"; id: string; name: string; input: unknown }
    >;
  }>;
}

function extractToolInput<T>(response: Awaited<ReturnType<typeof anthropicMessages>>, toolName: string): T {
  const block = response.content.find((b) => b.type === "tool_use" && b.name === toolName);
  if (!block || block.type !== "tool_use") {
    throw new Error(`Claude response did not include expected tool_use block "${toolName}"`);
  }
  return block.input as T;
}

const listingCopySchema = {
  type: "object",
  properties: {
    etsy_title: {
      type: "string",
      description: `SEO-optimized Etsy listing title, at most ${MAX_TITLE_LENGTH} characters.`,
    },
    etsy_tags: {
      type: "array",
      items: { type: "string" },
      minItems: TAG_COUNT,
      maxItems: TAG_COUNT,
      description: `Exactly ${TAG_COUNT} Etsy search tags, each at most ${MAX_TAG_LENGTH} characters.`,
    },
    etsy_description: {
      type: "string",
      description: "Full Etsy listing description: what it is, sizing/format notes, and styling suggestions.",
    },
  },
  required: ["etsy_title", "etsy_tags", "etsy_description"],
};

/** Normalizes one listing-copy variant against model drift — see comments below for what's been observed. */
function sanitizeListingCopy(copy: ListingCopy): ListingCopy {
  // Tool-use schemas aren't always followed exactly — etsy_tags has been
  // observed coming back as a comma-separated string instead of an array
  // despite the array schema, so normalize before relying on array methods.
  const rawTags: unknown = copy.etsy_tags;
  const tagsArray = Array.isArray(rawTags)
    ? rawTags
    : String(rawTags)
        .split(/[,\n]/)
        .map((t) => t.trim())
        .filter(Boolean);

  // Also seen: stray tool-call-looking fragments (e.g. "</etsy_description>",
  // "</invoke>") bleeding into the end of free-text fields. Strip them.
  const stripStrayTags = (text: string) => text.replace(/<\/?[a-z_]+>\s*/gi, "").trim();

  return {
    etsy_title: stripStrayTags(copy.etsy_title).slice(0, MAX_TITLE_LENGTH),
    etsy_tags: tagsArray.slice(0, TAG_COUNT).map((t) => String(t).slice(0, MAX_TAG_LENGTH)),
    etsy_description: stripStrayTags(copy.etsy_description),
  };
}

/**
 * Generates one art theme + two Etsy listing-copy variants for the given
 * niche: one for the digital-download listing, one for the physical
 * Printify-fulfilled listing. These have to read differently — a digital
 * listing promises an instant printable file with no shipment, a physical
 * one promises a shipped, ready-to-hang printed product — so reusing one
 * description across both would just be wrong on whichever one it's not
 * written for. Uses a forced tool call so the response is guaranteed
 * well-formed JSON rather than parsing free text.
 */
export async function generateListing(niche: Niche, orientation: Orientation = "vertical"): Promise<GeneratedListing> {
  const orientationGuidance =
    orientation === "horizontal"
      ? "This piece will be printed on a WIDE/LANDSCAPE canvas (wider than it is tall). Compose the scene so it " +
        "reads well in a wide format — e.g. a horizontal sweep of subject matter or a scene with side-to-side " +
        "visual interest — not a portrait composition that would just get cropped or stretched to fit."
      : "This piece will be printed on a TALL/PORTRAIT canvas (taller than it is wide). Compose the scene so it " +
        "reads well in a tall format — vertical visual flow or a centered subject with headroom — not a " +
        "landscape composition that would just get cropped or stretched to fit.";

  const response = await anthropicMessages({
    model: model(),
    max_tokens: 2500,
    system:
      "You are an Etsy print-on-demand and digital download listing copywriter and art director. " +
      "You generate a single new, sellable wall-art concept per request, along with SEO-optimized " +
      "Etsy listing copy for TWO separate listings of the same artwork: a digital download listing " +
      "and a physical printed (canvas/poster) listing. Never reuse or closely paraphrase a well-known " +
      "copyrighted character, logo, or brand — all concepts must be original.",
    tools: [
      {
        name: "emit_listing",
        description: "Emit one generated art theme, its image prompt, and separate digital/physical listing copy.",
        input_schema: {
          type: "object",
          properties: {
            theme: { type: "string", description: "Short internal name for this art concept." },
            image_prompt: {
              type: "string",
              description: `Detailed text-to-image generation prompt describing composition, subject, style, palette, and mood. Must match the orientation given in the request. At most ${MAX_IMAGE_PROMPT_LENGTH} characters — the image API this feeds into rejects longer prompts.`,
            },
            digital: {
              ...listingCopySchema,
              description:
                "Listing copy for the DIGITAL DOWNLOAD version: an instant-download printable file, no physical " +
                "item ships. Title/tags should include digital-download search terms (e.g. 'printable', 'digital " +
                "download', 'instant download'). Description must clearly state it's a digital file only, list " +
                "included print sizes/ratios, and give print-at-home or local-print-shop guidance.",
            },
            physical: {
              ...listingCopySchema,
              description:
                "Listing copy for the PHYSICAL PRINTED version: a canvas/poster print that ships to the buyer, " +
                "produced via print-on-demand. Title/tags should include physical-product search terms (e.g. " +
                "'canvas wall art', 'ready to hang', 'framed print') and must NOT use digital-download language " +
                "like 'printable' or 'instant download'. Description must clearly state it's a physical item that " +
                "ships, mention it arrives ready to hang, and give a general production/shipping timeframe note " +
                "rather than exact dates.",
            },
          },
          required: ["theme", "image_prompt", "digital", "physical"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "emit_listing" },
    messages: [
      {
        role: "user",
        content:
          `Generate one new wall-art concept for the "${niche.name}" niche.\n` +
          `Niche description: ${niche.description}\n` +
          `Visual style guidance: ${niche.prompt_style}\n` +
          `Orientation: ${orientationGuidance}\n\n` +
          `Requirements:\n` +
          `- etsy_title (both variants): <= ${MAX_TITLE_LENGTH} characters, keyword-rich, no clickbait.\n` +
          `- etsy_tags (both variants): exactly ${TAG_COUNT} tags, each <= ${MAX_TAG_LENGTH} characters, no duplicates.\n` +
          `- image_prompt: <= ${MAX_IMAGE_PROMPT_LENGTH} characters, specific enough for a text-to-image model to produce a print-ready piece of art.\n` +
          `- The digital and physical descriptions must NOT contradict each other's delivery method — see the field descriptions above.\n` +
          `- The concept must be original — do not reference any real copyrighted character, logo, or brand.`,
      },
    ],
  });

  const listing = extractToolInput<GeneratedListing>(response, "emit_listing");

  listing.image_prompt = listing.image_prompt.slice(0, MAX_IMAGE_PROMPT_LENGTH);
  listing.digital = sanitizeListingCopy(listing.digital);
  listing.physical = sanitizeListingCopy(listing.physical);

  return listing;
}

/**
 * Sends the finished image to Claude vision for an IP/compliance check.
 * Flags recognizable copyrighted characters/logos, real public figures, or
 * trademarked brands. Fails closed: if the model call itself errors, the
 * caller should treat that as "not approved" rather than silently publishing.
 */
export async function checkImageCompliance(imageUrl: string): Promise<ComplianceResult> {
  const imageRes = await fetch(imageUrl);
  if (!imageRes.ok) {
    throw new Error(`Failed to fetch image for compliance check: ${imageRes.status}`);
  }
  const mediaType = imageRes.headers.get("content-type") || "image/png";
  const buffer = Buffer.from(await imageRes.arrayBuffer());
  const base64 = buffer.toString("base64");

  const response = await anthropicMessages({
    model: model(),
    max_tokens: 500,
    system:
      "You are a strict IP/trademark compliance reviewer for a print-on-demand and digital art shop. " +
      "Examine the image and flag it if it contains: recognizable copyrighted characters or franchise " +
      "imagery, real public figures/celebrities, or trademarked brand names/logos. Generic, original, " +
      "or public-domain-style art should be approved.",
    tools: [
      {
        name: "emit_compliance_result",
        description: "Emit the compliance check result for this image.",
        input_schema: {
          type: "object",
          properties: {
            approved: { type: "boolean", description: "true if safe to publish, false if it must be rejected." },
            reason: { type: "string", description: "Brief explanation of the decision." },
          },
          required: ["approved", "reason"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "emit_compliance_result" },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          {
            type: "text",
            text:
              "Review this image for copyrighted characters/logos, real public figures, or trademarked " +
              "brands. Respond via the emit_compliance_result tool.",
          },
        ],
      },
    ],
  });

  const result = extractToolInput<ComplianceResult>(response, "emit_compliance_result");
  return result;
}
