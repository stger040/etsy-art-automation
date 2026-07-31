import "dotenv/config";
import { createDraftDigitalListing, uploadDigitalFile, uploadListingImage } from "../lib/etsy";
import type { ListingCopy } from "../lib/types";

const DEFAULT_TEST_IMAGE = "https://placehold.co/1500x2000.png?text=art";

async function main() {
  console.log("*** This creates a REAL draft listing in your Etsy shop. It will NOT be activated/published. ***");

  const listing: ListingCopy = {
    etsy_title: "Test Draft Listing - Botanical Line Art Printable Wall Decor (pipeline test)",
    etsy_tags: [
      "botanical art",
      "line art print",
      "minimalist decor",
      "printable art",
      "wall art print",
      "digital download",
      "plant illustration",
      "modern decor",
      "instant download",
      "home decor gift",
      "boho wall art",
      "neutral wall art",
      "leaf line art",
    ],
    etsy_description: "This is a test listing created by the pipeline's isolated Etsy test script.",
  };

  const { listingId } = await createDraftDigitalListing(listing);
  console.log("Created draft listing:", listingId);

  const runFullTest = process.argv.includes("--full");
  if (runFullTest) {
    const imageUrl = process.argv[2]?.startsWith("http") ? process.argv[2] : DEFAULT_TEST_IMAGE;
    console.log("Uploading digital file + listing image...");
    await uploadDigitalFile(listingId, imageUrl, "test-file.png");
    await uploadListingImage(listingId, imageUrl);
    console.log("Done.");
  } else {
    console.log("(Pass --full to also test uploadDigitalFile/uploadListingImage.)");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
