import "dotenv/config";
import { createAndPublishPodProducts } from "../lib/printify";
import type { ListingCopy } from "../lib/types";

const DEFAULT_TEST_IMAGE = "https://placehold.co/4500x6000.png?text=art";

async function main() {
  console.log(
    "*** This creates and PUBLISHES real Printify products to your connected Etsy shop. Delete/unpublish them afterwards if this is just a test. ***"
  );

  const imageUrl = process.argv[2] ?? DEFAULT_TEST_IMAGE;
  const listing: ListingCopy = {
    etsy_title: "Test Product - Botanical Line Art Poster (pipeline test)",
    etsy_tags: ["botanical art", "line art print", "minimalist decor", "poster print", "wall art"],
    etsy_description: "This is a test product created by the pipeline's isolated Printify test script.",
  };

  const { productIds } = await createAndPublishPodProducts(listing, imageUrl, `test-${Date.now()}`, 4500, 6000);
  console.log("Created + published product IDs:", productIds);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
