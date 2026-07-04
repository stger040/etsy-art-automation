import "dotenv/config";
import { upscaleImage } from "../lib/replicate";

const DEFAULT_TEST_IMAGE = "https://placehold.co/1024x1365.png?text=test";

async function main() {
  const imageUrl = process.argv[2] ?? DEFAULT_TEST_IMAGE;
  console.log(`Upscaling ${imageUrl} to >=4500x6000 (this can take a couple of minutes)...`);
  const result = await upscaleImage(imageUrl);
  console.log(`Upscaled: ${result.width}x${result.height}`);
  console.log("URL:", result.url);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
