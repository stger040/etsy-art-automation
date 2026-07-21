import { getEnv, requireEnv } from "./env";
import type { ComplianceResult, GeneratedListing, Niche } from "./types";

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

/**
 * Generates one art theme + Etsy listing copy for the given niche.
 * Uses a forced tool call so the response is guaranteed well-formed JSON
 * rather than parsing free text.
 */
export async function generateListing(niche: Niche): Promise<GeneratedListing> {
  const response = await anthropicMessages({
    model: model(),
    max_tokens: 1500,
    system:
      "You are an Etsy print-on-demand and digital download listing copywriter and art director. " +
      "You generate a single new, sellable wall-art concept per request, along with SEO-optimized " +
      "Etsy listing copy. Never reuse or closely paraphrase a well-known copyrighted character, logo, " +
      "or brand — all concepts must be original.",
    tools: [
      {
        name: "emit_listing",
        description: "Emit one generated art theme and its Etsy listing copy.",
        input_schema: {
          type: "object",
          properties: {
            theme: { type: "string", description: "Short internal name for this art concept." },
            image_prompt: {
              type: "string",
              description: `Detailed text-to-image generation prompt describing composition, subject, style, palette, and mood. At most ${MAX_IMAGE_PROMPT_LENGTH} characters — the image API this feeds into rejects longer prompts.`,
            },
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
          required: ["theme", "image_prompt", "etsy_title", "etsy_tags", "etsy_description"],
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
          `Visual style guidance: ${niche.prompt_style}\n\n` +
          `Requirements:\n` +
          `- etsy_title: <= ${MAX_TITLE_LENGTH} characters, keyword-rich, no clickbait.\n` +
          `- etsy_tags: exactly ${TAG_COUNT} tags, each <= ${MAX_TAG_LENGTH} characters, no duplicates.\n` +
          `- image_prompt: <= ${MAX_IMAGE_PROMPT_LENGTH} characters, specific enough for a text-to-image model to produce a print-ready piece of art.\n` +
          `- The concept must be original — do not reference any real copyrighted character, logo, or brand.`,
      },
    ],
  });

  const listing = extractToolInput<GeneratedListing>(response, "emit_listing");

  // Defensive trimming in case the model drifts slightly outside limits.
  // Tool-use schemas aren't always followed exactly — etsy_tags has been
  // observed coming back as a comma-separated string instead of an array
  // despite the array schema, so normalize before relying on array methods.
  const rawTags: unknown = listing.etsy_tags;
  const tagsArray = Array.isArray(rawTags)
    ? rawTags
    : String(rawTags)
        .split(/[,\n]/)
        .map((t) => t.trim())
        .filter(Boolean);

  listing.etsy_title = listing.etsy_title.slice(0, MAX_TITLE_LENGTH);
  listing.etsy_tags = tagsArray.slice(0, TAG_COUNT).map((t) => String(t).slice(0, MAX_TAG_LENGTH));
  listing.image_prompt = listing.image_prompt.slice(0, MAX_IMAGE_PROMPT_LENGTH);

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
