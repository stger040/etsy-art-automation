import "dotenv/config";
import { uploadToBlob } from "../lib/blob";

const DEFAULT_TEST_IMAGE = "https://placehold.co/600x800.png?text=test";

async function main() {
  const imageUrl = process.argv[2] ?? DEFAULT_TEST_IMAGE;
  console.log(`Uploading ${imageUrl} to Vercel Blob...`);
  const url = await uploadToBlob(imageUrl, `test-${Date.now()}`);
  console.log("Blob URL:", url);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
