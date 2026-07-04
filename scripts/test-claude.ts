import "dotenv/config";
import { generateListing, checkImageCompliance } from "../lib/claude";
import type { Niche } from "../lib/types";

async function main() {
  const niche: Niche = {
    id: 0,
    name: "Botanical line art",
    description: "Minimalist single-line botanical illustrations",
    prompt_style: "fine continuous-line art, botanical, minimalist, neutral background",
    active: true,
    last_used_at: null,
    created_at: new Date().toISOString(),
  };

  console.log("Generating listing copy...");
  const listing = await generateListing(niche);
  console.log(JSON.stringify(listing, null, 2));
  console.log(`Title length: ${listing.etsy_title.length} (max 140)`);
  console.log(`Tag count: ${listing.etsy_tags.length} (need 13), max tag length: ${Math.max(...listing.etsy_tags.map((t) => t.length))} (max 20)`);

  const imageUrl = process.argv[2];
  if (imageUrl) {
    console.log(`\nRunning compliance check against ${imageUrl} ...`);
    const result = await checkImageCompliance(imageUrl);
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log("\n(Pass an image URL as an argument to also test checkImageCompliance.)");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
